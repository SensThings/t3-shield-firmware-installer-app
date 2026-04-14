import json
import logging
import os
import re
import shutil
import subprocess
import signal
import time
from pathlib import Path
from typing import Callable

from ..utils.error_handler import get_operator_message, diagnose_test_result
from ..utils.operation_logger import write_operation_log

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).parent.parent / "assets"
SDR_DIR = ASSETS_DIR / "sdr"


def _find_uhd_images_dir() -> str:
    for base in ["/usr/share/uhd", "/usr/local/share/uhd", "/opt/uhd/share/uhd"]:
        images = os.path.join(base, "images")
        if os.path.isdir(images):
            return images
    return ""


def _find_b210_serials(env: dict) -> list[str]:
    """Find all B210 device serial numbers on this machine."""
    result = subprocess.run(
        ["uhd_find_devices"], capture_output=True, text=True, timeout=30, env=env
    )
    output = result.stdout + result.stderr
    serials = []
    current_serial = None
    for line in output.split("\n"):
        m = re.search(r"serial:\s*(\S+)", line)
        if m:
            current_serial = m.group(1)
        if ("type: b200" in line or "product: B210" in line) and current_serial:
            if current_serial not in serials:
                serials.append(current_serial)
            current_serial = None
    return serials


def _load_config(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.warning("Failed to load antenna config %s: %s", path, e)
        return {}


def _resolve_config_path() -> Path:
    user_cfg = Path.home() / ".t3s-installer" / "antenna_test_config.json"
    default_cfg = SDR_DIR / "antenna_test_config.json"
    return user_cfg if user_cfg.exists() else default_cfg


def _log_config(config: dict, source: Path):
    logger.info(
        "Antenna test config loaded from %s: center_freq=%.0f, snr_threshold=%.1f, "
        "freq_tolerance=%.0f, search_bw=%.0f, tx_gain=%.0f, rx_gain=%.0f",
        source,
        config.get("center_freq_hz", 0),
        config.get("snr_threshold_db", 0),
        config.get("freq_tolerance_hz", 0),
        config.get("search_bandwidth_hz", 0),
        config.get("tx_gain", 0),
        config.get("rx_gain", 0),
    )


def _log_test_summary(label: str, rx_result: dict, diagnosis: dict | None, config_source: Path):
    lines = [f"Antenna test complete: label={label}, result={rx_result.get('status', '?')}, config={config_source}"]
    for ch_key in ["channel_a", "channel_b"]:
        ch = rx_result.get(ch_key)
        if ch:
            lines.append(
                f"  {ch_key}: snr={ch.get('snr_db', '?')}dB (threshold={ch.get('snr_threshold_db', '?')}), "
                f"freq_err={ch.get('freq_error_hz', '?')}Hz, peak={ch.get('peak_freq_hz', '?')}Hz, status={ch.get('status', '?')}"
            )
    if not rx_result.get("channel_a"):
        lines.append(
            f"  single: snr={rx_result.get('snr_db', '?')}dB, freq_err={rx_result.get('freq_error_hz', '?')}Hz, status={rx_result.get('status', '?')}"
        )
    if diagnosis:
        lines.append(f"  diagnosis: {diagnosis.get('failure_type', '?')}, is_config_issue={diagnosis.get('is_config_issue', False)}")
    logger.info("\n".join(lines))


def run_antenna_test(label: str, dual_channel: bool, emit: Callable):
    """Run antenna validation test: TX on SDR #1, RX on SDR #2, both on this desktop."""
    tx_proc = None
    rx_proc = None
    num_rx_channels = 2 if dual_channel else 1
    config_path = _resolve_config_path()
    config = _load_config(config_path)

    logger.info("Starting antenna test (label: %s, channels: %d)", label, num_rx_channels)
    _log_config(config, config_path)

    try:
        # === PREP: Check desktop SDRs ===
        emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "in_progress", "message": "Recherche des SDR..."})

        uhd_path = shutil.which("uhd_find_devices")
        if not uhd_path:
            emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "fail",
                               "message": get_operator_message("antenna_test", "check_desktop_sdrs", "uhd_not_found")})
            raise RuntimeError("UHD tools not installed")

        uhd_images = _find_uhd_images_dir()
        env = os.environ.copy()
        if uhd_images:
            env["UHD_IMAGES_DIR"] = uhd_images

        try:
            serials = _find_b210_serials(env)
            logger.info("Found B210 serials: %s", serials)
        except subprocess.TimeoutExpired:
            emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "fail",
                               "message": get_operator_message("antenna_test", "check_desktop_sdrs", "timeout")})
            raise RuntimeError("uhd_find_devices timed out")

        if len(serials) < 2:
            emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "fail",
                               "message": get_operator_message("antenna_test", "check_desktop_sdrs", "not_enough_sdrs")})
            raise RuntimeError(f"Need 2 B210 SDRs, found {len(serials)}")

        tx_serial = serials[0]
        rx_serial = serials[1]
        emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "pass",
                           "message": f"TX: {tx_serial}, RX: {rx_serial}"})

        # === PREP: Start TX (single channel, on SDR #1) ===
        emit("prep_step", {"step_id": "start_transmitter", "status": "in_progress", "message": "Démarrage émetteur..."})

        config_file = str(config_path)
        tx_script = str(SDR_DIR / "tx_tone.py")
        tx_log = open("/tmp/t3s-antenna-tx-stderr.log", "w")

        try:
            tx_proc = subprocess.Popen(
                ["python3", tx_script, "--channels", "1", "--device", tx_serial, "--config", config_file],
                cwd=str(SDR_DIR),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=tx_log,
            )
        except Exception as e:
            tx_log.close()
            logger.error("Failed to start TX: %s", e)
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail",
                               "message": get_operator_message("antenna_test", "start_transmitter", "fail")})
            raise RuntimeError(f"Failed to start TX: {e}")

        logger.info("TX started (PID: %d, device: %s)", tx_proc.pid, tx_serial)

        init_wait = config.get("tx_init_wait_s", 5)
        time.sleep(init_wait)

        if tx_proc.poll() is not None:
            tx_log.close()
            try:
                tx_stderr = Path("/tmp/t3s-antenna-tx-stderr.log").read_text()
                logger.error("TX stderr: %s", tx_stderr[:500])
            except Exception:
                pass
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail",
                               "message": get_operator_message("antenna_test", "start_transmitter", "tx_died")})
            raise RuntimeError("TX process died during initialization")

        emit("prep_step", {"step_id": "start_transmitter", "status": "pass", "message": "Émetteur actif"})

        # === RUN: Start RX locally (on SDR #2) ===
        emit("step_update", {"step_number": 1, "status": "in_progress", "message": "Démarrage récepteur..."})

        rx_script = str(SDR_DIR / "rx_tone.py")
        rx_json = "/tmp/antenna-rx-result.json"
        rx_log_path = "/tmp/antenna-rx-stderr.log"

        for f in [rx_json, rx_log_path]:
            try:
                os.remove(f)
            except FileNotFoundError:
                pass

        rx_out = open(rx_json, "w")
        rx_err = open(rx_log_path, "w")

        try:
            rx_proc = subprocess.Popen(
                ["python3", rx_script, "--channels", str(num_rx_channels), "--device", rx_serial, "--single-tone", "--config", config_file],
                cwd=str(SDR_DIR),
                env=env,
                stdout=rx_out,
                stderr=rx_err,
            )
        except Exception as e:
            rx_out.close()
            rx_err.close()
            logger.error("Failed to start RX: %s", e)
            emit("step_update", {"step_number": 1, "status": "fail",
                                 "message": get_operator_message("antenna_test", "start_receiver", "fail")})
            raise RuntimeError(f"Failed to start RX: {e}")

        logger.info("RX started (PID: %d, device: %s, channels: %d)", rx_proc.pid, rx_serial, num_rx_channels)

        # Wait for RX to start streaming
        rx_init_timeout = int(config.get("rx_init_timeout_s", 60))
        init_waited = 0
        while init_waited < rx_init_timeout:
            try:
                with open(rx_log_path, "r") as f:
                    if "Streaming" in f.read():
                        logger.info("RX streaming started after %ds", init_waited)
                        break
            except FileNotFoundError:
                pass
            if rx_proc.poll() is not None:
                logger.error("RX died during init (code: %s)", rx_proc.returncode)
                rx_out.close()
                rx_err.close()
                try:
                    rx_stderr = Path(rx_log_path).read_text()
                    logger.error("RX stderr: %s", rx_stderr[:500])
                except Exception:
                    pass
                emit("step_update", {"step_number": 1, "status": "fail",
                                     "message": get_operator_message("antenna_test", "start_receiver", "died")})
                raise RuntimeError("RX process died during initialization")
            time.sleep(1)
            init_waited += 1

        if init_waited >= rx_init_timeout:
            emit("step_update", {"step_number": 1, "status": "fail",
                                 "message": get_operator_message("antenna_test", "start_receiver", "timeout")})
            raise RuntimeError("RX initialization timed out")

        emit("step_update", {"step_number": 1, "status": "pass", "message": "Récepteur actif", "duration": round(init_waited, 1)})

        # === Capture ===
        emit("step_update", {"step_number": 2, "status": "in_progress", "message": "Capture en cours..."})
        capture_duration = config.get("capture_duration_s", 5)
        time.sleep(capture_duration)

        # Stop RX gracefully
        rx_proc.send_signal(signal.SIGINT)
        try:
            rx_proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            rx_proc.kill()
            rx_proc.wait()

        rx_out.close()
        rx_err.close()

        emit("step_update", {"step_number": 2, "status": "pass", "message": f"Capture {capture_duration}s terminée", "duration": float(capture_duration)})

        # === Validate ===
        emit("step_update", {"step_number": 3, "status": "in_progress", "message": "Validation..."})

        rx_result = None
        try:
            with open(rx_json, "r") as f:
                content = f.read().strip()
                for line in content.split("\n"):
                    line = line.strip()
                    if line.startswith("{"):
                        rx_result = json.loads(line)
                        break
        except (FileNotFoundError, json.JSONDecodeError) as e:
            logger.error("Failed to parse RX result: %s", e)

        if not rx_result:
            emit("step_update", {"step_number": 3, "status": "fail",
                                 "message": get_operator_message("antenna_test", "validate_results", "no_json")})
            raise RuntimeError("No JSON result from RX")

        overall_status = rx_result.get("status", "FAIL")

        # Diagnose the result — no technical values in UI messages
        diagnosis = None
        if overall_status == "PASS":
            if dual_channel:
                ch_a = rx_result.get("channel_a", {})
                ch_b = rx_result.get("channel_b", {})
                msg = f"Canal A: {'OK' if ch_a.get('status') == 'PASS' else 'Échoué'} | Canal B: {'OK' if ch_b.get('status') == 'PASS' else 'Échoué'}"
            else:
                msg = "Signal validé"
            emit("step_update", {"step_number": 3, "status": "pass", "message": msg, "duration": 0.1})
        else:
            diagnosis = diagnose_test_result(rx_result, "antenna_test")
            logger.warning("Antenna test FAILED: %s", diagnosis.get("failure_type"))

            emit("step_update", {"step_number": 3, "status": "fail",
                                 "message": diagnosis["operator_message"], "duration": 0.1,
                                 "operator_message": diagnosis["operator_message"]})

        # Build final result
        result = {
            "operation": "antenna_test",
            "result": "pass" if overall_status == "PASS" else "fail",
            "started_at": "",
            "finished_at": "",
            "metrics": rx_result,
            "steps": [],
        }

        if diagnosis:
            result["diagnosis"] = diagnosis

        _log_test_summary(label, rx_result, diagnosis, config_path)
        write_operation_log(
            operation="antenna-test", serial=label or "unnamed", result=result["result"],
            config=config, metrics=rx_result, diagnosis=diagnosis,
            stderr_files={"tx": "/tmp/t3s-antenna-tx-stderr.log", "rx": "/tmp/antenna-rx-stderr.log"},
        )
        emit("test_complete", result)
        return result

    except Exception as e:
        msg = str(e)
        logger.error("Antenna test failed: %s", msg)
        if "Need 2 B210" in msg:
            operator_msg = get_operator_message("antenna_test", "check_desktop_sdrs", "not_enough_sdrs")
        elif "UHD" in msg or "uhd" in msg:
            operator_msg = get_operator_message("antenna_test", "check_desktop_sdrs", "uhd_not_found")
        elif "timed out" in msg.lower():
            operator_msg = get_operator_message("antenna_test", "start_receiver", "timeout")
        elif "TX" in msg:
            operator_msg = get_operator_message("antenna_test", "start_transmitter", "tx_died")
        elif "RX" in msg:
            operator_msg = get_operator_message("antenna_test", "start_receiver", "fail")
        else:
            operator_msg = get_operator_message("antenna_test", "validate_results", "fail")
        write_operation_log(
            operation="antenna-test", serial=label or "unnamed", result="fail",
            config=config, error=msg,
            stderr_files={"tx": "/tmp/t3s-antenna-tx-stderr.log", "rx": "/tmp/antenna-rx-stderr.log"},
        )
        emit("test_error", {"error": msg, "operator_message": operator_msg})
        raise
    finally:
        if tx_proc and tx_proc.poll() is None:
            tx_proc.terminate()
            try:
                tx_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                tx_proc.kill()
        if rx_proc and rx_proc.poll() is None:
            rx_proc.terminate()
            try:
                rx_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                rx_proc.kill()
        logger.info("Antenna test cleanup complete")
