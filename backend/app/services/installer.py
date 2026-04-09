import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from ..services import ssh_service, offline_assets
from ..utils.progress_parser import OutputProcessor

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).parent.parent / "assets"


def _get_install_script() -> str:
    return (ASSETS_DIR / "install.sh").read_text()


def run_install(serial_number: str, settings, emit: Callable):
    """Run the full offline installation flow."""
    hostname = f"T3S-{serial_number}"
    paths = offline_assets.get_cache_paths()
    conn = None

    logger.info("Starting install for %s (host: %s)", hostname, settings.device_ip)

    try:
        # === PHASE 1: Prepare offline assets ===
        logger.info("=== Phase 1: Preparing offline assets ===")

        emit("prep_step", {"step_id": "prepare_docker", "status": "in_progress", "message": "Checking Docker binaries..."})
        offline_assets.prepare_docker_binaries(
            on_progress=lambda msg: emit("prep_step", {"step_id": "prepare_docker", "status": "in_progress", "message": msg})
        )
        emit("prep_step", {"step_id": "prepare_docker", "status": "pass", "message": "Docker binaries ready"})

        emit("prep_step", {"step_id": "prepare_firmware", "status": "in_progress", "message": "Checking firmware image..."})
        offline_assets.prepare_firmware_image(
            settings.firmware_image, settings.ghcr_username, settings.ghcr_token,
            on_progress=lambda msg: emit("prep_step", {"step_id": "prepare_firmware", "status": "in_progress", "message": msg})
        )
        emit("prep_step", {"step_id": "prepare_firmware", "status": "pass", "message": "Firmware image ready"})

        # === PHASE 2: Connect and upload to Pi ===
        logger.info("=== Phase 2: Uploading to Pi ===")

        conn = ssh_service.connect(settings.device_ip, settings.ssh_username, settings.ssh_password)
        logger.info("SSH connected to %s", settings.device_ip)

        # Upload install script
        emit("prep_step", {"step_id": "upload_script", "status": "in_progress", "message": "Uploading install script..."})
        script = _get_install_script()
        conn.upload_file(script, "/tmp/install.sh")
        logger.info("Uploaded install.sh")
        emit("prep_step", {"step_id": "upload_script", "status": "pass", "message": "Install script uploaded"})

        # Upload Docker binaries — skip if already on Pi
        stdout, _, code = conn.exec_command("command -v docker 2>/dev/null && docker --version 2>/dev/null")
        if code == 0 and "Docker" in stdout:
            logger.info("Docker already on Pi, skipping upload")
            emit("prep_step", {"step_id": "upload_docker", "status": "pass", "message": "Docker already installed on device"})
        else:
            emit("prep_step", {"step_id": "upload_docker", "status": "in_progress", "message": "Uploading Docker binaries..."})
            # Tar the docker dir, upload, extract
            docker_dir = paths["docker_dir"]
            tar_path = os.path.join(paths["cache_dir"], "docker-upload.tar.gz")
            subprocess.run(["tar", "czf", tar_path, "-C", docker_dir, "."], check=True, capture_output=True)
            conn.upload_large_file(
                tar_path, "/tmp/docker-static.tar.gz",
                on_progress=lambda pct: emit("prep_step", {"step_id": "upload_docker", "status": "in_progress", "message": f"Uploading Docker binaries ({pct}%)..."})
            )
            conn.exec_command("mkdir -p /tmp/docker-static && tar xzf /tmp/docker-static.tar.gz -C /tmp/docker-static && rm /tmp/docker-static.tar.gz")
            emit("prep_step", {"step_id": "upload_docker", "status": "pass", "message": "Docker binaries uploaded"})

        # Upload firmware tar
        emit("prep_step", {"step_id": "upload_firmware", "status": "in_progress", "message": "Uploading firmware image..."})
        size_mb = os.path.getsize(paths["firmware_tar"]) // (1024 * 1024)
        conn.upload_large_file(
            paths["firmware_tar"], "/tmp/firmware.tar",
            on_progress=lambda pct: emit("prep_step", {"step_id": "upload_firmware", "status": "in_progress", "message": f"Uploading firmware ({pct}%, {size_mb}MB)..."})
        )
        emit("prep_step", {"step_id": "upload_firmware", "status": "pass", "message": f"Firmware uploaded ({size_mb}MB)"})

        # === PHASE 3: Run install script ===
        logger.info("=== Phase 3: Running install script ===")

        command = f"sudo bash /tmp/install.sh --image-tar /tmp/firmware.tar --hostname {hostname} --json 2>&1"
        logger.info("Executing: %s", command)

        processor = OutputProcessor()

        def on_output(data: str):
            events = processor.process_data(data)
            for event in events:
                emit(event["type"], event["data"])

        exit_code = conn.exec_stream(command, on_output)
        logger.info("install.sh exited with code: %d", exit_code)

        result = processor.extract_json_fallback()
        if result:
            emit("install_complete", result)
            return result

        logger.warning("No JSON result from install.sh")
        fail_result = {
            "operation": "install",
            "image": settings.firmware_image,
            "version": None,
            "result": "fail",
            "steps": [],
        }
        emit("install_complete", fail_result)
        return fail_result

    except Exception as e:
        msg = str(e)
        logger.error("Install failed: %s", msg)
        if "timed out" in msg.lower() or "refused" in msg.lower():
            msg = f"Cannot reach device at {settings.device_ip} — check Ethernet cable"
        elif "authentication" in msg.lower():
            msg = "Authentication failed — check credentials in Settings"
        emit("install_error", {"error": msg})
        raise
    finally:
        if conn:
            conn.close()
        logger.info("SSH connection closed")
