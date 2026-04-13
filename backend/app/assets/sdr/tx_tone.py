#!/usr/bin/env python3
"""Continuous tone transmitter via USRP B210. Runs until SIGTERM/SIGINT.
Supports single-channel (default) or dual-channel mode via --channels flag.
"""

import argparse
import signal
import sys
import numpy as np
import uhd

from config import CENTER_FREQ, SAMPLE_RATE, TONE_OFFSET_A, TONE_OFFSET_B, TX_GAIN

RUNNING = True


def stop(sig, frame):
    global RUNNING
    RUNNING = False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channels", type=int, default=1, choices=[1, 2])
    parser.add_argument("--device", type=str, default="", help="UHD device serial (e.g. 000000544)")
    parser.add_argument("--config", type=str, default="", help="Path to JSON config file (parsed by config.py)")
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    num_channels = args.channels
    dev_args = f"serial={args.device}" if args.device else ""

    try:
        usrp = uhd.usrp.MultiUSRP(dev_args)
    except Exception as e:
        print(f"[TX] FATAL: Failed to open USRP device ({dev_args}): {e}", file=sys.stderr)
        sys.exit(1)

    try:
        usrp.set_tx_rate(SAMPLE_RATE)
        for ch in range(num_channels):
            usrp.set_tx_freq(uhd.libpyuhd.types.tune_request(CENTER_FREQ), ch)
            usrp.set_tx_gain(TX_GAIN, ch)
    except Exception as e:
        print(f"[TX] FATAL: Failed to configure USRP: {e}", file=sys.stderr)
        sys.exit(1)

    offsets = [TONE_OFFSET_A, TONE_OFFSET_B][:num_channels]
    labels = ["A", "B"][:num_channels]

    print(f"[TX] Freq={CENTER_FREQ/1e6:.1f} MHz  Channels={num_channels}  "
          f"Tones={[f'{o/1e3:.0f}kHz' for o in offsets]}  "
          f"Gain={TX_GAIN}  Rate={SAMPLE_RATE/1e6:.1f} MS/s")

    # Generate tone(s)
    chunk = 4096
    t = np.arange(chunk) / SAMPLE_RATE

    st_args = uhd.usrp.StreamArgs("fc32", "sc16")
    if num_channels == 2:
        st_args.channels = [0, 1]
        tone_a = (0.8 * np.exp(2j * np.pi * TONE_OFFSET_A * t)).astype(np.complex64)
        tone_b = (0.8 * np.exp(2j * np.pi * TONE_OFFSET_B * t)).astype(np.complex64)
        # UHD 4.1 requires 2D numpy array, not list of buffers
        tone_2d = np.vstack([tone_a, tone_b])
        streamer = usrp.get_tx_stream(st_args)
        metadata = uhd.types.TXMetadata()
        print("[TX] Streaming (dual-channel) ...")
        sys.stdout.flush()
        while RUNNING:
            streamer.send(tone_2d, metadata)
        metadata.end_of_burst = True
        streamer.send(np.zeros((2, chunk), dtype=np.complex64), metadata)
    else:
        tone = (0.8 * np.exp(2j * np.pi * TONE_OFFSET_A * t)).astype(np.complex64)
        streamer = usrp.get_tx_stream(st_args)
        metadata = uhd.types.TXMetadata()
        print("[TX] Streaming ...")
        sys.stdout.flush()
        while RUNNING:
            streamer.send(tone, metadata)
        metadata.end_of_burst = True
        streamer.send(np.zeros(chunk, dtype=np.complex64), metadata)

    print("[TX] Stopped.")


if __name__ == "__main__":
    main()
