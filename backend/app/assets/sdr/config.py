"""
Shared SDR config for B210 TX/RX validation.
WARNING: Direct coax connection — keep TX_GAIN low or use a 30dB attenuator.
"""

CENTER_FREQ = 884e6
SAMPLE_RATE = 1e6

# Channel A tone offset (+100 kHz)
TONE_OFFSET_A = 100e3
# Channel B tone offset (+250 kHz) — 150 kHz separation for clean isolation
TONE_OFFSET_B = 250e3
# Backward compat alias for single-channel mode
TONE_OFFSET = TONE_OFFSET_A

TX_GAIN = 0
RX_GAIN = 0

CAPTURE_DURATION = 5.0

TONE_SNR_MIN_DB = 15.0
FREQ_TOLERANCE_HZ = 5e3
