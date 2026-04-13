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


def diagnose_channel(channel: dict) -> dict:
    """Binary diagnosis of one channel result. No magic numbers — uses thresholds from the result.

    Args:
        channel: dict with keys: status, snr_db, snr_threshold_db, freq_error_hz, peak_freq_hz, expected_freq_hz
                 (as returned by rx_tone.py analyze())

    Returns:
        dict with: snr_pass (bool), freq_pass (bool), failure_type (str), is_config_issue (bool)
    """
    snr_pass = channel.get("snr_db", 0) >= channel.get("snr_threshold_db", 0)
    freq_pass = channel.get("freq_error_hz", float("inf")) <= channel.get("freq_tolerance_hz",
        # freq_tolerance_hz may not be in the result — derive from status + other fields
        # If not present, use the pass/fail from status combined with snr
        float("inf"))

    # If freq_tolerance_hz is not in result, infer from the channel status and snr
    if "freq_tolerance_hz" not in channel:
        # status is the ground truth from rx_tone.py
        if channel.get("status") == "PASS":
            snr_pass = True
            freq_pass = True
        elif snr_pass:
            # SNR passed but overall status is FAIL → freq must have failed
            freq_pass = False
        else:
            # SNR failed — freq could be either, but we can't tell without tolerance
            freq_pass = channel.get("status") != "FAIL"

    if snr_pass and freq_pass:
        failure_type = "pass"
    elif snr_pass and not freq_pass:
        failure_type = "snr_pass_freq_fail"
    elif not snr_pass and freq_pass:
        failure_type = "snr_fail_freq_pass"
    else:
        failure_type = "snr_fail_freq_fail"

    return {
        "snr_pass": snr_pass,
        "freq_pass": freq_pass,
        "failure_type": failure_type,
        "is_config_issue": failure_type == "snr_pass_freq_fail",
    }


def diagnose_test_result(metrics: dict, category: str) -> dict:
    """Diagnose SDR or antenna test result. Pure binary logic — no hardcoded thresholds.

    Args:
        metrics: the metrics dict from rx_tone.py (may contain channel_a, channel_b, or top-level)
        category: 'sdr_test' or 'antenna_test'

    Returns:
        dict with: failure_type, is_config_issue, operator_message, channels (per-channel diagnosis)
    """
    channels = {}

    if "channel_a" in metrics:
        channels["a"] = diagnose_channel(metrics["channel_a"])
    if "channel_b" in metrics:
        channels["b"] = diagnose_channel(metrics["channel_b"])

    # If no per-channel data, diagnose the top-level metrics
    if not channels and metrics.get("status"):
        channels["a"] = diagnose_channel(metrics)

    # Determine composite failure type
    failed_channels = {k: v for k, v in channels.items() if v["failure_type"] != "pass"}

    if not failed_channels:
        failure_type = "pass"
        is_config_issue = False
    elif len(failed_channels) == 1:
        ch_key = next(iter(failed_channels))
        ch_diag = failed_channels[ch_key]
        failure_type = ch_diag["failure_type"]
        is_config_issue = ch_diag["is_config_issue"]
    else:
        # Both channels failed — check if same failure type
        types = set(v["failure_type"] for v in failed_channels.values())
        if len(types) == 1:
            failure_type = f"{next(iter(types))}_both"
            is_config_issue = all(v["is_config_issue"] for v in failed_channels.values())
        else:
            # Mixed failures — use the worst case
            failure_type = "fail_both" if category == "antenna_test" else "fail_both_channels"
            is_config_issue = False

    # Get the appropriate operator message
    if failure_type == "pass":
        operator_message = ""
    else:
        # Try specific message first, then channel-specific, then generic fail
        msg = get_operator_message(category, "validate_results", failure_type)
        # If we got the generic fallback, try per-channel message
        if msg == "Une erreur est survenue. Réessayez ou signalez au responsable.":
            if len(failed_channels) == 1:
                ch_key = next(iter(failed_channels))
                msg = get_operator_message(category, "validate_results", f"fail_channel_{ch_key}")
            else:
                msg = get_operator_message(category, "validate_results", "fail")
        operator_message = msg

    return {
        "failure_type": failure_type,
        "is_config_issue": is_config_issue,
        "operator_message": operator_message,
        "channels": channels,
    }


def load_checklist() -> list[dict]:
    """Load the pre-flight checklist items."""
    path = Path(__file__).parent / "checklist.json"
    with open(path) as f:
        return json.load(f)
