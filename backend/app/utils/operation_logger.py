"""Write detailed JSON log files for each operation (install, sdr-test, antenna-test).

Logs are stored in ~/.t3s-installer/logs/<operation>/ and never deleted.
Each file is a complete record for remote diagnosis.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

LOG_BASE = Path.home() / ".t3s-installer" / "logs"


def write_operation_log(
    operation: str,
    serial: str,
    result: str,
    config: dict | None = None,
    metrics: dict | None = None,
    diagnosis: dict | None = None,
    steps: list | None = None,
    error: str | None = None,
    extra: dict | None = None,
):
    """Write a detailed JSON log file for one operation.

    Args:
        operation: 'install', 'sdr-test', or 'antenna-test'
        serial: device serial number or label
        result: 'pass' or 'fail'
        config: full config snapshot used for this run
        metrics: raw test metrics (SNR, freq, power — the technical details)
        diagnosis: diagnosis dict from error_handler
        steps: list of step results with durations
        error: error message if failed
        extra: any additional data to include
    """
    log_dir = LOG_BASE / operation
    log_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%d_%H-%M-%S")
    safe_serial = serial.replace("/", "-").replace(" ", "_") or "unknown"
    filename = f"{timestamp}_{safe_serial}.json"

    log_entry = {
        "timestamp": now.isoformat(),
        "operation": operation,
        "serial": serial,
        "result": result,
        "config": config,
        "metrics": metrics,
        "diagnosis": diagnosis,
        "steps": steps,
        "error": error,
    }
    if extra:
        log_entry.update(extra)

    path = log_dir / filename
    try:
        path.write_text(json.dumps(log_entry, indent=2, default=str) + "\n")
        logger.info("Operation log written: %s", path)
    except OSError as e:
        logger.error("Failed to write operation log %s: %s", path, e)
