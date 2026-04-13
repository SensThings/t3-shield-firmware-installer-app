import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

from ..services import ssh_service
from ..utils.progress_parser import OutputProcessor
from ..utils.error_handler import (
    get_operator_message, get_connection_message, diagnose_test_result,
)
from ..utils.operation_logger import write_operation_log

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).parent.parent / "assets"
SDR_DIR = ASSETS_DIR / "sdr"


def _find_uhd_images_dir() -> str:
    """Find UHD images directory on this machine."""
    for base in ["/usr/share/uhd", "/usr/local/share/uhd", "/opt/uhd/share/uhd"]:
        images = os.path.join(base, "images")
        if os.path.isdir(images):
            return images
    return ""


def _load_config(path: Path) -> dict:
    """Load a JSON config file, return empty dict on error."""
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.warning("Failed to load config %s: %s", path, e)
        return {}


def _resolve_config_path(name: str) -> Path:
    """Resolve user-writable config path, falling back to shipped default."""
    user_cfg = Path.home() / ".t3s-installer" / f"{name}_test_config.json"
    default_cfg = SDR_DIR / f"{name}_test_config.json"
    if user_cfg.exists():
        return user_cfg
    return default_cfg


def _log_config(config: dict, source: Path, label: str):
    """Log key config values for debugging."""
    logger.info(
        "%s config loaded from %s: center_freq=%.0f, snr_threshold=%.1f, "
        "freq_tolerance=%.0f, search_bw=%.0f, tx_gain=%.0f, rx_gain=%.0f",
        label, source,
        config.get("center_freq_hz", 0),
        config.get("snr_threshold_db", 0),
        config.get("freq_tolerance_hz", 0),
        config.get("search_bandwidth_hz", 0),
        config.get("tx_gain", 0),
        config.get("rx_gain", 0),
    )


def _log_test_summary(serial: str, result: dict, diagnosis: dict | None, config_source: Path):
    """Log a single structured test summary."""
    metrics = result.get("metrics", {})
    lines = [f"SDR test complete: serial={serial}, result={result.get('result', '?')}, config={config_source}"]

    for ch_key in ["channel_a", "channel_b"]:
        ch = metrics.get(ch_key)
        if ch:
            snr_ok = "PASS" if ch.get("snr_db", 0) >= ch.get("snr_threshold_db", 0) else "FAIL"
            freq_ok = "PASS" if ch.get("freq_error_hz", float("inf")) <= ch.get("snr_threshold_db", 0) else "?"
            lines.append(
                f"  {ch_key}: snr={ch.get('snr_db', '?')}dB (threshold={ch.get('snr_threshold_db', '?')} {snr_ok}), "
                f"freq_err={ch.get('freq_error_hz', '?')}Hz, peak={ch.get('peak_freq_hz', '?')}Hz, status={ch.get('status', '?')}"
            )

    if diagnosis:
        lines.append(f"  diagnosis: {diagnosis.get('failure_type', '?')}, is_config_issue={diagnosis.get('is_config_issue', False)}")

    logger.info("\n".join(lines))


def run_sdr_test(serial_number: str, settings, emit: Callable, dual_channel: bool = True):
    """Run SDR validation test: TX on this desktop, RX on Pi."""
    conn = None
    tx_proc = None
    num_channels = 2 if dual_channel else 1
    config_path = _resolve_config_path("sdr")
    config = _load_config(config_path)

    logger.info("Starting SDR test for %s (device: %s, channels: %d)",
                serial_number, settings.device_ip, num_channels)
    _log_config(config, config_path, "SDR test")

    try:
        # === PREP: Check desktop SDR ===
        emit("prep_step", {"step_id": "check_desktop_sdr", "status": "in_progress", "message": "Checking desktop SDR..."})

        uhd_path = shutil.which("uhd_find_devices")
        if not uhd_path:
            emit("prep_step", {"step_id": "check_desktop_sdr", "status": "fail",
                               "message": get_operator_message("sdr_test", "init_receiver", "uhd_not_found")})
            raise RuntimeError("UHD tools not installed on this machine")

        uhd_images = _find_uhd_images_dir()
        env = os.environ.copy()
        if uhd_images:
            env["UHD_IMAGES_DIR"] = uhd_images

        try:
            result = subprocess.run(["uhd_find_devices"], capture_output=True, text=True, timeout=30, env=env)
            output = result.stdout + result.stderr
            logger.info("uhd_find_devices: %s", output.strip()[:200])
        except subprocess.TimeoutExpired:
            emit("prep_step", {"step_id": "check_desktop_sdr", "status": "fail",
                               "message": get_operator_message("sdr_test", "init_receiver", "timeout")})
            raise RuntimeError("uhd_find_devices timed out")

        if "type: b200" not in output and "product: B210" not in output:
            emit("prep_step", {"step_id": "check_desktop_sdr", "status": "fail",
                               "message": get_operator_message("sdr_test", "init_receiver", "no_b210")})
            raise RuntimeError("No B210 SDR detected on this machine")

        emit("prep_step", {"step_id": "check_desktop_sdr", "status": "pass", "message": "Desktop SDR ready"})

        # === PREP: Upload test scripts to Pi ===
        emit("prep_step", {"step_id": "upload_test_scripts", "status": "in_progress", "message": "Connecting to device..."})

        conn = ssh_service.connect(settings.device_ip, settings.ssh_username, settings.ssh_password)
        logger.info("Connected to Pi")

        try:
            conn.exec_command("mkdir -p /tmp/sdr")
            conn.upload_file((SDR_DIR / "config.py").read_text(), "/tmp/sdr/config.py")
            conn.upload_file((SDR_DIR / "rx_tone.py").read_text(), "/tmp/sdr/rx_tone.py")
            conn.upload_file((SDR_DIR / "test.sh").read_text(), "/tmp/sdr/test.sh")
            conn.upload_file(config_path.read_text(), "/tmp/sdr/sdr_test_config.json")
            logger.info("Uploaded SDR test scripts to Pi (config: %s)", config_path)
        except Exception as e:
            logger.error("Failed to upload test scripts: %s", e)
            emit("prep_step", {"step_id": "upload_test_scripts", "status": "fail",
                               "message": get_operator_message("sdr_test", "run_test", "upload_failed")})
            raise RuntimeError(f"Failed to upload test scripts: {e}")

        emit("prep_step", {"step_id": "upload_test_scripts", "status": "pass", "message": "Test scripts uploaded"})

        # === PREP: Start TX locally ===
        emit("prep_step", {"step_id": "start_transmitter", "status": "in_progress", "message": "Starting transmitter..."})

        config_file = str(config_path)
        capture_duration = config.get("capture_duration_s", 5)
        tx_script = str(SDR_DIR / "tx_tone.py")

        tx_log = open("/tmp/t3s-tx-stderr.log", "w")
        try:
            tx_proc = subprocess.Popen(
                ["python3", tx_script, "--channels", str(num_channels), "--config", config_file],
                cwd=str(SDR_DIR),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=tx_log,
            )
        except Exception as e:
            tx_log.close()
            logger.error("Failed to start TX process: %s", e)
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail",
                               "message": get_operator_message("sdr_test", "run_test", "tx_died")})
            raise RuntimeError(f"Failed to start TX: {e}")

        logger.info("TX started (PID: %d, channels: %d)", tx_proc.pid, num_channels)

        # Wait for TX to initialize
        init_wait = config.get("tx_init_wait_dual_s", 8) if dual_channel else config.get("tx_init_wait_s", 5)
        time.sleep(init_wait)

        if tx_proc.poll() is not None:
            tx_log.close()
            # Read TX stderr for diagnostics
            try:
                tx_stderr = Path("/tmp/t3s-tx-stderr.log").read_text()
                logger.error("TX stderr: %s", tx_stderr[:500])
            except Exception:
                pass
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail",
                               "message": get_operator_message("sdr_test", "run_test", "tx_died")})
            raise RuntimeError("TX process died during initialization")

        ch_label = "double canal" if dual_channel else "canal unique"
        emit("prep_step", {"step_id": "start_transmitter", "status": "pass", "message": f"Émetteur actif ({ch_label})"})

        # === RUN: Execute test.sh on Pi ===
        logger.info("Running test.sh on Pi")

        command = f"bash /tmp/sdr/test.sh --duration {int(capture_duration)} --channels {num_channels} --config /tmp/sdr/sdr_test_config.json --json 2>&1"
        processor = OutputProcessor()

        def on_output(data: str):
            events = processor.process_data(data)
            for event in events:
                emit(event["type"], event["data"])

        try:
            exit_code = conn.exec_stream(command, on_output, timeout=int(config.get("rx_init_timeout_s", 120)))
        except Exception as e:
            logger.error("test.sh stream failed: %s", e)
            emit("test_error", {"error": str(e),
                                "operator_message": get_operator_message("sdr_test", "run_test", "streaming_timeout")})
            raise
        logger.info("test.sh exited with code: %d", exit_code)

        # Stop TX
        if tx_proc and tx_proc.poll() is None:
            tx_proc.terminate()
            try:
                tx_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tx_proc.kill()
            logger.info("TX stopped")
        tx_log.close()

        test_result = processor.extract_json_fallback()
        if test_result:
            # Diagnose and enrich failed results
            if test_result.get("result") == "fail":
                diagnosis = diagnose_test_result(test_result.get("metrics", {}), "sdr_test")
                test_result["diagnosis"] = diagnosis
                logger.warning("SDR test FAILED: %s", diagnosis.get("failure_type"))

                # Enrich steps with specific operator messages
                for step in test_result.get("steps", []):
                    if step.get("status") == "fail" and step.get("name") == "validate_results":
                        step["operator_message"] = diagnosis["operator_message"]
                    elif step.get("status") == "fail":
                        step["operator_message"] = get_operator_message("sdr_test", step.get("name", ""), "fail")

            _log_test_summary(serial_number, test_result, test_result.get("diagnosis"), config_path)
            write_operation_log(
                operation="sdr-test", serial=serial_number, result=test_result.get("result", "fail"),
                config=config, metrics=test_result.get("metrics"),
                diagnosis=test_result.get("diagnosis"), steps=test_result.get("steps"),
            )
            emit("test_complete", test_result)
            return test_result

        logger.warning("No JSON result from test.sh")
        fail_result = {
            "operation": "sdr_test",
            "result": "fail",
            "steps": [],
            "operator_message": get_operator_message("sdr_test", "run_test", "no_json"),
        }
        write_operation_log(
            operation="sdr-test", serial=serial_number, result="fail",
            config=config, error="No JSON result from test.sh",
        )
        emit("test_complete", fail_result)
        return fail_result

    except Exception as e:
        msg = str(e)
        logger.error("SDR test failed: %s", msg)
        if "timed out" in msg.lower() or "refused" in msg.lower():
            operator_msg = get_connection_message("unreachable")
        elif "authentication" in msg.lower():
            operator_msg = get_connection_message("auth_failed")
        elif "No B210" in msg:
            operator_msg = get_operator_message("sdr_test", "init_receiver", "no_b210")
        elif "UHD" in msg:
            operator_msg = get_operator_message("sdr_test", "init_receiver", "uhd_not_found")
        elif "upload" in msg.lower():
            operator_msg = get_operator_message("sdr_test", "run_test", "upload_failed")
        elif "TX" in msg:
            operator_msg = get_operator_message("sdr_test", "run_test", "tx_died")
        else:
            operator_msg = get_operator_message("sdr_test", "run_test", "fail")
        write_operation_log(
            operation="sdr-test", serial=serial_number, result="fail",
            config=config, error=msg,
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
        if conn:
            conn.close()
        logger.info("Cleanup complete")
