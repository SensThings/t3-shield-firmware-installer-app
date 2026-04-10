#!/usr/bin/env python3
"""
Continuous receiver via USRP B210.
Supports single-channel (default) or dual-channel mode via --channels flag.
Captures in chunks, runs FFT analysis, writes JSON results to stdout.
Runs until SIGTERM/SIGINT.
"""

import argparse
import json
import signal
import sys
import numpy as np
import uhd

from config import (CENTER_FREQ, SAMPLE_RATE, TONE_OFFSET_A, TONE_OFFSET_B,
                    RX_GAIN, TONE_SNR_MIN_DB, FREQ_TOLERANCE_HZ)

RUNNING = True
ANALYSIS_SAMPLES = 65536


def stop(sig, frame):
    global RUNNING
    RUNNING = False


def analyze(samples, expected_offset):
    """Run FFT analysis on samples, looking for tone at expected_offset."""
    N = len(samples)
    window = np.hanning(N)
    spectrum = np.fft.fftshift(np.fft.fft(samples * window))
    magnitude = 20 * np.log10(np.abs(spectrum) + 1e-12)
    freqs = np.fft.fftshift(np.fft.fftfreq(N, 1.0 / SAMPLE_RATE))

    peak_idx = np.argmax(magnitude)
    peak_freq = freqs[peak_idx]
    peak_power = magnitude[peak_idx]

    noise_mask = np.ones(N, dtype=bool)
    guard = int(N * FREQ_TOLERANCE_HZ / SAMPLE_RATE) * 2
    lo = max(0, peak_idx - guard)
    hi = min(N, peak_idx + guard)
    noise_mask[lo:hi] = False
    noise_floor = np.mean(magnitude[noise_mask])

    snr_db = peak_power - noise_floor
    freq_error = abs(peak_freq - expected_offset)
    tone_ok = snr_db >= TONE_SNR_MIN_DB and freq_error <= FREQ_TOLERANCE_HZ

    return {
        "status": "PASS" if tone_ok else "FAIL",
        "peak_freq_hz": round(float(peak_freq), 1),
        "expected_freq_hz": float(expected_offset),
        "freq_error_hz": round(float(freq_error), 1),
        "snr_db": round(float(snr_db), 2),
        "snr_threshold_db": float(TONE_SNR_MIN_DB),
        "peak_power_db": round(float(peak_power), 2),
        "noise_floor_db": round(float(noise_floor), 2),
    }


def analyze_ring(ring, ring_pos):
    """Extract ordered samples from a ring buffer and return them."""
    if ring_pos >= ANALYSIS_SAMPLES:
        return np.roll(ring, -(ring_pos % ANALYSIS_SAMPLES))
    elif ring_pos > 0:
        return ring[:ring_pos]
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channels", type=int, default=1, choices=[1, 2])
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    num_channels = args.channels
    usrp = uhd.usrp.MultiUSRP()
    usrp.set_rx_rate(SAMPLE_RATE)

    for ch in range(num_channels):
        usrp.set_rx_freq(uhd.libpyuhd.types.tune_request(CENTER_FREQ), ch)
        usrp.set_rx_gain(RX_GAIN, ch)

    channel_labels = ["A", "B"][:num_channels]
    offsets = [TONE_OFFSET_A, TONE_OFFSET_B][:num_channels]

    print(f"[RX] Freq={CENTER_FREQ/1e6:.1f} MHz  Channels={num_channels}  "
          f"Gain={RX_GAIN}  Rate={SAMPLE_RATE/1e6:.1f} MS/s", file=sys.stderr)

    st_args = uhd.usrp.StreamArgs("fc32", "sc16")
    if num_channels == 2:
        st_args.channels = [0, 1]

    streamer = usrp.get_rx_stream(st_args)
    metadata = uhd.types.RXMetadata()

    stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
    if num_channels > 1:
        # Multi-channel requires timed start for time alignment
        import time as _time
        usrp.set_time_now(uhd.types.TimeSpec(0.0))
        _time.sleep(0.1)
        stream_cmd.stream_now = False
        stream_cmd.time_spec = usrp.get_time_now() + uhd.types.TimeSpec(1.0)
    else:
        stream_cmd.stream_now = True
    streamer.issue_stream_cmd(stream_cmd)

    chunk_size = streamer.get_max_num_samps()

    # Ring buffers per channel
    rings = [np.zeros(ANALYSIS_SAMPLES, dtype=np.complex64) for _ in range(num_channels)]
    ring_positions = [0] * num_channels

    print("[RX] Streaming ...", file=sys.stderr)
    sys.stderr.flush()

    if num_channels == 2:
        # Dual-channel receive: use 2D numpy array (UHD 4.1 requires this, not list)
        while RUNNING:
            buf2d = np.zeros((2, chunk_size), dtype=np.complex64)
            nrecv = streamer.recv(buf2d, metadata, timeout=5.0)
            if metadata.error_code == uhd.types.RXMetadataErrorCode.overflow:
                continue
            if metadata.error_code != uhd.types.RXMetadataErrorCode.none:
                print(f"[RX] Error: {metadata.error_code}", file=sys.stderr)
                continue
            for ch in range(2):
                for i in range(nrecv):
                    rings[ch][ring_positions[ch] % ANALYSIS_SAMPLES] = buf2d[ch][i]
                    ring_positions[ch] += 1
    else:
        # Single-channel receive (original behavior)
        while RUNNING:
            buf = np.zeros(chunk_size, dtype=np.complex64)
            nrecv = streamer.recv(buf, metadata)
            if metadata.error_code == uhd.types.RXMetadataErrorCode.overflow:
                continue
            if metadata.error_code != uhd.types.RXMetadataErrorCode.none:
                print(f"[RX] Error: {metadata.error_code}", file=sys.stderr)
                continue
            for i in range(nrecv):
                rings[0][ring_positions[0] % ANALYSIS_SAMPLES] = buf[i]
                ring_positions[0] += 1

    stop_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
    streamer.issue_stream_cmd(stop_cmd)

    total_samples = sum(ring_positions)
    print(f"[RX] Stopped. Total samples: {total_samples}", file=sys.stderr)

    if num_channels == 2:
        # Dual-channel: per-channel analysis
        results = {}
        all_pass = True
        for ch in range(2):
            samples = analyze_ring(rings[ch], ring_positions[ch])
            if samples is not None:
                ch_result = analyze(samples, offsets[ch])
            else:
                ch_result = {"status": "FAIL", "error": "No samples captured"}
            key = f"channel_{channel_labels[ch].lower()}"
            results[key] = ch_result
            if ch_result["status"] != "PASS":
                all_pass = False

        results["status"] = "PASS" if all_pass else "FAIL"
        print(json.dumps(results))
    else:
        # Single-channel: original flat result
        samples = analyze_ring(rings[0], ring_positions[0])
        if samples is not None:
            result = analyze(samples, offsets[0])
        else:
            result = {"status": "FAIL", "error": "No samples captured"}
        print(json.dumps(result))


if __name__ == "__main__":
    main()
