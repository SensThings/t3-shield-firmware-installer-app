"""
Shared SDR config for B210 TX/RX validation.
WARNING: Direct coax connection — keep TX_GAIN low or use a 30dB attenuator.
"""

CENTER_FREQ = 884e6
SAMPLE_RATE = 1e6
TONE_OFFSET = 100e3

TX_GAIN = 0
RX_GAIN = 0

CAPTURE_DURATION = 5.0

TONE_SNR_MIN_DB = 15.0
FREQ_TOLERANCE_HZ = 5e3
