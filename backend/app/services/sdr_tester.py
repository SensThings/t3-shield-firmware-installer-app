import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

from ..services import ssh_service
from ..utils.progress_parser import OutputProcessor

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


def run_sdr_test(serial_number: str, settings, emit: Callable):
    """Run SDR validation test: TX on this desktop, RX on Pi."""
    conn = None
    tx_proc = None

    logger.info("Starting SDR test for T3S-%s (device: %s)", serial_number, settings.device_ip)

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
        logger.info("Uploaded SDR test scripts to Pi")

        emit("prep_step", {"step_id": "upload_test_scripts", "status": "pass", "message": "Test scripts uploaded"})

        # === PREP: Start TX locally ===
        emit("prep_step", {"step_id": "start_transmitter", "status": "in_progress", "message": "Starting transmitter..."})

        capture_duration = 5
        tx_script = str(SDR_DIR / "tx_tone.py")

        tx_proc = subprocess.Popen(
            ["python3", tx_script],
            cwd=str(SDR_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        logger.info("TX started (PID: %d)", tx_proc.pid)

        # Wait for TX to initialize (UHD firmware load)
        time.sleep(5)

        if tx_proc.poll() is not None:
            output = tx_proc.stdout.read().decode() if tx_proc.stdout else ""
            logger.error("TX exited early: %s", output[:500])
            emit("prep_step", {"step_id": "start_transmitter", "status": "fail", "message": "Transmitter failed to start"})
            raise RuntimeError(f"TX process died: {output[:200]}")

        emit("prep_step", {"step_id": "start_transmitter", "status": "pass", "message": "Transmitter active"})

        # === RUN: Execute test.sh on Pi ===
        logger.info("Running test.sh on Pi")

        command = f"bash /tmp/sdr/test.sh --duration {capture_duration} --json 2>&1"
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
            msg = f"Cannot reach device at {settings.device_ip} — check Ethernet cable"
        emit("test_error", {"error": msg})
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
