import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_messages: dict = {}


def _load_messages():
    global _messages
    if _messages:
        return
    path = Path(__file__).parent / "error_messages.json"
    with open(path) as f:
        _messages = json.load(f)
    logger.info("Loaded error messages from %s", path)


def get_operator_message(category: str, step_name: str, error_type: str = "fail") -> str:
    """Get a French operator-friendly message for a specific error.

    Args:
        category: 'install', 'sdr_test', 'connection', or 'preparation'
        step_name: the step ID (e.g., 'set_hostname', 'run_test')
        error_type: 'fail', 'no_signal', 'low_snr', 'freq_error'

    Returns:
        French message string, or a generic fallback
    """
    _load_messages()

    cat = _messages.get(category, {})

    # Direct key (e.g., connection.unreachable)
    if isinstance(cat, str):
        return cat

    step = cat.get(step_name, {})

    # Direct string value
    if isinstance(step, str):
        return step

    # Dict with error types
    if isinstance(step, dict):
        msg = step.get(error_type, step.get("fail", ""))
        if msg:
            return msg

    return "Une erreur est survenue. Réessayez ou signalez au responsable."


def get_connection_message(error_type: str) -> str:
    """Get French message for connection errors."""
    _load_messages()
    return _messages.get("connection", {}).get(error_type, "Erreur de connexion. Vérifiez les câbles et réessayez.")


def get_prep_message(step_id: str) -> str:
    """Get French message for preparation step errors."""
    _load_messages()
    prep = _messages.get("preparation", {})
    step = prep.get(step_id, {})
    if isinstance(step, dict):
        return step.get("fail", "Erreur de préparation. Réessayez.")
    if isinstance(step, str):
        return step
    return "Erreur de préparation. Réessayez."


def load_checklist() -> list[dict]:
    """Load the pre-flight checklist items."""
    path = Path(__file__).parent / "checklist.json"
    with open(path) as f:
        return json.load(f)
