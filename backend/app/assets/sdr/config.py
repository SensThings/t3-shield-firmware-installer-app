"""
SDR config loader. Reads from JSON config files at runtime.
Scripts receive --config <path> to select which config to use.
Falls back to hardcoded defaults if no config file found.
"""

import json
import os
import sys

_DEFAULTS = {
    "center_freq_hz": 884e6,
    "sample_rate_hz": 1e6,
    "tone_offset_a_hz": 100e3,
    "tone_offset_b_hz": 250e3,
    "tx_gain": 0,
    "rx_gain": 0,
    "capture_duration_s": 5.0,
    "snr_threshold_db": 15.0,
    "freq_tolerance_hz": 5e3,
    "search_bandwidth_hz": 20e3,
    "rx_analysis_samples": 65536,
}

_config = dict(_DEFAULTS)

# Load from JSON if --config <path> is in argv
_config_path = None
for i, arg in enumerate(sys.argv):
    if arg == "--config" and i + 1 < len(sys.argv):
        _config_path = sys.argv[i + 1]
        break

# Also check env var
if not _config_path:
    _config_path = os.environ.get("SDR_CONFIG_PATH")

if _config_path and os.path.isfile(_config_path):
    try:
        with open(_config_path) as f:
            loaded = json.load(f)
            _config.update(loaded)
    except (json.JSONDecodeError, IOError):
        pass

# Export as module-level constants (used by tx_tone.py and rx_tone.py)
CENTER_FREQ = float(_config["center_freq_hz"])
SAMPLE_RATE = float(_config["sample_rate_hz"])
TONE_OFFSET_A = float(_config["tone_offset_a_hz"])
TONE_OFFSET_B = float(_config["tone_offset_b_hz"])
TONE_OFFSET = TONE_OFFSET_A
TX_GAIN = float(_config["tx_gain"])
RX_GAIN = float(_config["rx_gain"])
CAPTURE_DURATION = float(_config["capture_duration_s"])
TONE_SNR_MIN_DB = float(_config["snr_threshold_db"])
FREQ_TOLERANCE_HZ = float(_config["freq_tolerance_hz"])
SEARCH_BANDWIDTH_HZ = float(_config.get("search_bandwidth_hz", 20e3))
ANALYSIS_SAMPLES = int(_config.get("rx_analysis_samples", 65536))
