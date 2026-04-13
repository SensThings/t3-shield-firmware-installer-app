import json
import logging
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()

# Default configs shipped with the app (read-only in /opt)
ASSETS_DIR = Path(__file__).parent.parent / "assets" / "sdr"
_DEFAULTS = {
    "sdr": ASSETS_DIR / "sdr_test_config.json",
    "antenna": ASSETS_DIR / "antenna_test_config.json",
}

# User-writable config directory
DATA_DIR = Path.home() / ".t3s-installer"


def _config_path(name: str) -> Path:
    """Return writable config path, seeding from defaults if needed."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    user_file = DATA_DIR / f"{name}_test_config.json"
    if not user_file.exists():
        default_file = _DEFAULTS.get(name)
        if default_file and default_file.exists():
            shutil.copy2(default_file, user_file)
        else:
            user_file.write_text("{}\n")
    return user_file


def _read_config(name: str) -> dict:
    try:
        return json.loads(_config_path(name).read_text())
    except FileNotFoundError:
        logger.warning("Config file not found for %s, returning empty", name)
        return {}
    except json.JSONDecodeError as e:
        logger.error("Malformed JSON in %s config: %s", name, e)
        return {}


def _write_config(name: str, data: dict):
    path = _config_path(name)
    try:
        path.write_text(json.dumps(data, indent=4) + "\n")
    except OSError as e:
        logger.error("Failed to write config %s: %s", path, e)
        raise HTTPException(status_code=500, detail=f"Cannot write config: {e}")


@router.get("/config/sdr-test")
async def get_sdr_config():
    return _read_config("sdr")


@router.put("/config/sdr-test")
async def update_sdr_config(config: dict[str, Any] = Body(...)):
    current = _read_config("sdr")
    current.update(config)
    _write_config("sdr", current)
    logger.info("SDR test config updated: %s", list(config.keys()))
    return current


@router.get("/config/antenna-test")
async def get_antenna_config():
    return _read_config("antenna")


@router.put("/config/antenna-test")
async def update_antenna_config(config: dict[str, Any] = Body(...)):
    current = _read_config("antenna")
    current.update(config)
    _write_config("antenna", current)
    logger.info("Antenna test config updated: %s", list(config.keys()))
    return current


# --- Device settings (SSH, GHCR, firmware image) ---

_SETTINGS_DEFAULTS = {
    "device_ip": "192.168.137.100",
    "ssh_username": "dragon",
    "ssh_password": "Sensthings@012",
    "ghcr_username": "elmoadin",
    "ghcr_token": "",
    "firmware_image": "ghcr.io/sensthings/t3shield-firmware:latest",
}

_SETTINGS_FILE = DATA_DIR / "settings.json"


def _read_settings() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not _SETTINGS_FILE.exists():
        _SETTINGS_FILE.write_text(json.dumps(_SETTINGS_DEFAULTS, indent=4) + "\n")
    try:
        return json.loads(_SETTINGS_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(_SETTINGS_DEFAULTS)


def _write_settings(data: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _SETTINGS_FILE.write_text(json.dumps(data, indent=4) + "\n")
    except OSError as e:
        logger.error("Failed to write settings: %s", e)
        raise HTTPException(status_code=500, detail=f"Cannot write settings: {e}")


@router.get("/config/settings")
async def get_settings():
    return _read_settings()


@router.put("/config/settings")
async def update_settings(config: dict[str, Any] = Body(...)):
    current = _read_settings()
    current.update(config)
    _write_settings(current)
    logger.info("Device settings updated: %s", list(config.keys()))
    return current
