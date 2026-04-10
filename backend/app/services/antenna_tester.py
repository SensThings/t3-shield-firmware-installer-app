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

from ..utils.error_handler import get_operator_message

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


def run_antenna_test(label: str, dual_channel: bool, emit: Callable):
    """Run antenna validation test: TX on SDR #1, RX on SDR #2, both on this desktop."""
    tx_proc = None
    rx_proc = None
    num_rx_channels = 2 if dual_channel else 1

    logger.info("Starting antenna test (label: %s, channels: %d)", label, num_rx_channels)

    try:
        # === PREP: Check desktop SDRs ===
        emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "in_progress", "message": "Recherche des SDR..."})

        uhd_path = shutil.which("uhd_find_devices")
        if not uhd_path:
            emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "fail", "message": "uhd_find_devices non trouvé"})
            raise RuntimeError("UHD tools not installed")

        uhd_images = _find_uhd_images_dir()
        env = os.environ.copy()
        if uhd_images:
            env["UHD_IMAGES_DIR"] = uhd_images

        serials = _find_b210_serials(env)
        logger.info("Found B210 serials: %s", serials)

        if len(serials) < 2:
            emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "fail",
                               "message": f"Trouvé {len(serials)} SDR, 2 requis"})
            raise RuntimeError(f"Need 2 B210 SDRs, found {len(serials)}")

        tx_serial = serials[0]
        rx_serial = serials[1]
        emit("prep_step", {"step_id": "check_desktop_sdrs", "status": "pass",
                           "message": f"TX: {tx_serial}, RX: {rx_serial}"})

        # === PREP: Start TX (single channel, on SDR #1) ===
        emit("prep_step", {"step_id": "start_transmitter", "status": "in_progress", "message": "Démarrage émetteur..."})

        config_file = str(SDR_DIR / "antenna_test_config.json")
        tx_script = str(SDR_DIR / "tx_tone.py")
        tx_proc = subprocess.Popen(
            ["python3", tx_script, "--channels", "1", "--device", tx_serial, "--config", config_file],
            cwd=str(SDR_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info("TX started (PID: %d, device: %s)", tx_proc.pid, tx_serial)

        time.sleep(5)

        if tx_proc.poll() is not None:
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail", "message": "L'émetteur a échoué"})
            raise RuntimeError("TX process died during initialization")

        emit("prep_step", {"step_id": "start_transmitter", "status": "pass", "message": "Émetteur actif"})

        # === RUN: Start RX locally (on SDR #2) ===
        emit("step_update", {"step_number": 1, "status": "in_progress", "message": "Démarrage récepteur..."})

        rx_script = str(SDR_DIR / "rx_tone.py")
        rx_json = "/tmp/antenna-rx-result.json"
        rx_log = "/tmp/antenna-rx-stderr.log"

        # Clean previous results
        for f in [rx_json, rx_log]:
            try:
                os.remove(f)
            except FileNotFoundError:
                pass

        rx_out = open(rx_json, "w")
        rx_err = open(rx_log, "w")

        rx_proc = subprocess.Popen(
            ["python3", rx_script, "--channels", str(num_rx_channels), "--device", rx_serial, "--single-tone", "--config", config_file],
            cwd=str(SDR_DIR),
            env=env,
            stdout=rx_out,
            stderr=rx_err,
        )
        logger.info("RX started (PID: %d, device: %s, channels: %d)", rx_proc.pid, rx_serial, num_rx_channels)

        # Wait for RX to start streaming
        init_waited = 0
        while init_waited < 60:
            try:
                with open(rx_log, "r") as f:
                    if "Streaming" in f.read():
                        logger.info("RX streaming started after %ds", init_waited)
                        break
            except FileNotFoundError:
                pass
            if rx_proc.poll() is not None:
                logger.error("RX died during init")
                break
            time.sleep(1)
            init_waited += 1

        if init_waited >= 60:
            emit("step_update", {"step_number": 1, "status": "fail", "message": "Timeout initialisation récepteur"})
            raise RuntimeError("RX initialization timed out")

        emit("step_update", {"step_number": 1, "status": "pass", "message": "Récepteur actif", "duration": round(init_waited, 1)})

        # === Capture ===
        emit("step_update", {"step_number": 2, "status": "in_progress", "message": "Capture en cours..."})
        capture_duration = 5
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
            emit("step_update", {"step_number": 3, "status": "fail", "message": "Pas de résultat du récepteur"})
            raise RuntimeError("No JSON result from RX")

        overall_status = rx_result.get("status", "FAIL")
        if overall_status == "PASS":
            if dual_channel:
                ch_a = rx_result.get("channel_a", {})
                ch_b = rx_result.get("channel_b", {})
                msg = f"A: {ch_a.get('status')} (SNR {ch_a.get('snr_db')} dB) | B: {ch_b.get('status')} (SNR {ch_b.get('snr_db')} dB)"
            else:
                msg = f"SNR: {rx_result.get('snr_db')} dB"
            emit("step_update", {"step_number": 3, "status": "pass", "message": msg, "duration": 0.1})
        else:
            if dual_channel:
                ch_a = rx_result.get("channel_a", {})
                ch_b = rx_result.get("channel_b", {})
                msg = f"A: {ch_a.get('status')} | B: {ch_b.get('status')} — test échoué"
            else:
                msg = f"SNR: {rx_result.get('snr_db')} dB — sous le seuil"
            emit("step_update", {"step_number": 3, "status": "fail", "message": msg, "duration": 0.1})

        # Build final result
        result = {
            "operation": "antenna_test",
            "result": "pass" if overall_status == "PASS" else "fail",
            "started_at": "",
            "finished_at": "",
            "metrics": rx_result,
            "steps": [],
        }

        if result["result"] == "fail":
            for step in result.get("steps", []):
                if step.get("status") == "fail":
                    step["operator_message"] = get_operator_message("antenna_test", step.get("name", ""), "fail")

        emit("test_complete", result)
        return result

    except Exception as e:
        msg = str(e)
        logger.error("Antenna test failed: %s", msg)
        if "Need 2 B210" in msg:
            operator_msg = "Deux SDR B210 sont nécessaires pour le test d'antennes. Vérifiez les connexions USB."
        elif "UHD" in msg or "uhd" in msg:
            operator_msg = "Outils SDR non disponibles sur ce poste."
        else:
            operator_msg = "Une erreur est survenue. Réessayez ou signalez au responsable."
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
