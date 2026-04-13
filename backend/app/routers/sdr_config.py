import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body

logger = logging.getLogger(__name__)
router = APIRouter()

ASSETS_DIR = Path(__file__).parent.parent / "assets" / "sdr"
SDR_CONFIG = ASSETS_DIR / "sdr_test_config.json"
ANTENNA_CONFIG = ASSETS_DIR / "antenna_test_config.json"


def _read_config(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_config(path: Path, data: dict):
    path.write_text(json.dumps(data, indent=4) + "\n")


@router.get("/config/sdr-test")
async def get_sdr_config():
    return _read_config(SDR_CONFIG)


@router.put("/config/sdr-test")
async def update_sdr_config(config: dict[str, Any] = Body(...)):
    current = _read_config(SDR_CONFIG)
    current.update(config)
    _write_config(SDR_CONFIG, current)
    logger.info("SDR test config updated: %s", list(config.keys()))
    return current


@router.get("/config/antenna-test")
async def get_antenna_config():
    return _read_config(ANTENNA_CONFIG)


@router.put("/config/antenna-test")
async def update_antenna_config(config: dict[str, Any] = Body(...)):
    current = _read_config(ANTENNA_CONFIG)
    current.update(config)
    _write_config(ANTENNA_CONFIG, current)
    logger.info("Antenna test config updated: %s", list(config.keys()))
    return current
