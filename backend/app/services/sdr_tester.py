import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

from ..services import ssh_service
from ..utils.progress_parser import OutputProcessor
from ..utils.error_handler import get_operator_message, get_connection_message

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


def run_sdr_test(serial_number: str, settings, emit: Callable, dual_channel: bool = True):
    """Run SDR validation test: TX on this desktop, RX on Pi."""
    conn = None
    tx_proc = None
    num_channels = 2 if dual_channel else 1

    logger.info("Starting SDR test for T3S-%s (device: %s, channels: %d)",
                serial_number, settings.device_ip, num_channels)

    try:
        # === PREP: Check desktop SDR ===
        emit("prep_step", {"step_id": "check_desktop_sdr", "status": "in_progress", "message": "Checking desktop SDR..."})

        # Verify UHD is available
        uhd_path = shutil.which("uhd_find_devices")
        if not uhd_path:
            emit("prep_step", {"step_id": "check_desktop_sdr", "status": "fail", "message": "uhd_find_devices not found"})
            raise RuntimeError("UHD tools not installed on this machine")

        uhd_images = _find_uhd_images_dir()
        env = os.environ.copy()
        if uhd_images:
            env["UHD_IMAGES_DIR"] = uhd_images

        result = subprocess.run(["uhd_find_devices"], capture_output=True, text=True, timeout=30, env=env)
        output = result.stdout + result.stderr
        logger.info("uhd_find_devices: %s", output.strip()[:200])

        if "type: b200" not in output and "product: B210" not in output:
            emit("prep_step", {"step_id": "check_desktop_sdr", "status": "fail", "message": "No B210 SDR detected — check USB"})
            raise RuntimeError("No B210 SDR detected on this machine")

        emit("prep_step", {"step_id": "check_desktop_sdr", "status": "pass", "message": "Desktop SDR ready"})

        # === PREP: Upload test scripts to Pi ===
        emit("prep_step", {"step_id": "upload_test_scripts", "status": "in_progress", "message": "Connecting to device..."})

        conn = ssh_service.connect(settings.device_ip, settings.ssh_username, settings.ssh_password)
        logger.info("Connected to Pi")

        conn.exec_command("mkdir -p /tmp/sdr")
        conn.upload_file((SDR_DIR / "config.py").read_text(), "/tmp/sdr/config.py")
        conn.upload_file((SDR_DIR / "rx_tone.py").read_text(), "/tmp/sdr/rx_tone.py")
        conn.upload_file((SDR_DIR / "test.sh").read_text(), "/tmp/sdr/test.sh")
        user_sdr_cfg = Path.home() / ".t3s-installer" / "sdr_test_config.json"
        sdr_cfg_path = user_sdr_cfg if user_sdr_cfg.exists() else SDR_DIR / "sdr_test_config.json"
        conn.upload_file(sdr_cfg_path.read_text(), "/tmp/sdr/sdr_test_config.json")
        logger.info("Uploaded SDR test scripts to Pi")

        emit("prep_step", {"step_id": "upload_test_scripts", "status": "pass", "message": "Test scripts uploaded"})

        # === PREP: Start TX locally ===
        emit("prep_step", {"step_id": "start_transmitter", "status": "in_progress", "message": "Starting transmitter..."})

        # Use user-writable config if it exists, else fall back to default
        user_config = Path.home() / ".t3s-installer" / "sdr_test_config.json"
        config_file = str(user_config if user_config.exists() else SDR_DIR / "sdr_test_config.json")
        capture_duration = 5
        tx_script = str(SDR_DIR / "tx_tone.py")

        tx_proc = subprocess.Popen(
            ["python3", tx_script, "--channels", str(num_channels), "--config", config_file],
            cwd=str(SDR_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info("TX started (PID: %d, channels: %d)", tx_proc.pid, num_channels)

        # Wait for TX to initialize (UHD firmware load — longer for dual-channel)
        time.sleep(8 if dual_channel else 5)

        if tx_proc.poll() is not None:
            logger.error("TX exited early (code: %s)", tx_proc.returncode)
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail", "message": "Transmitter failed to start"})
            raise RuntimeError("TX process died during initialization")

        ch_label = "double canal" if dual_channel else "canal unique"
        emit("prep_step", {"step_id": "start_transmitter", "status": "pass", "message": f"Émetteur actif ({ch_label})"})

        # === RUN: Execute test.sh on Pi ===
        logger.info("Running test.sh on Pi")

        command = f"bash /tmp/sdr/test.sh --duration {capture_duration} --channels {num_channels} --config /tmp/sdr/sdr_test_config.json --json 2>&1"
        processor = OutputProcessor()

        def on_output(data: str):
            events = processor.process_data(data)
            for event in events:
                emit(event["type"], event["data"])

        exit_code = conn.exec_stream(command, on_output, timeout=120)
        logger.info("test.sh exited with code: %d", exit_code)

        # Stop TX
        if tx_proc and tx_proc.poll() is None:
            tx_proc.terminate()
            try:
                tx_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tx_proc.kill()
            logger.info("TX stopped")

        result = processor.extract_json_fallback()
        if result:
            # Enrich failed steps with operator messages
            if result.get("result") == "fail":
                for step in result.get("steps", []):
                    if step.get("status") == "fail":
                        step["operator_message"] = get_operator_message("sdr_test", step.get("name", ""), "fail")
            emit("test_complete", result)
            return result

        logger.warning("No JSON result from test.sh")
        fail_result = {"operation": "sdr_test", "result": "fail", "steps": []}
        emit("test_complete", fail_result)
        return fail_result

    except Exception as e:
        msg = str(e)
        logger.error("SDR test failed: %s", msg)
        if "timed out" in msg.lower() or "refused" in msg.lower():
            operator_msg = get_connection_message("unreachable")
        elif "authentication" in msg.lower():
            operator_msg = get_connection_message("auth_failed")
        elif "No B210" in msg or "UHD" in msg:
            operator_msg = get_operator_message("sdr_test", "init_receiver", "fail")
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
        if conn:
            conn.close()
        logger.info("Cleanup complete")
