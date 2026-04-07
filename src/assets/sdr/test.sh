#!/bin/bash
# =============================================================================
# SDR Validation Test — Receiver Side
# =============================================================================
# Runs on the target device via SSH. The desktop runs the transmitter.
#
# Usage:
#   bash /tmp/sdr/test.sh --duration 5 --json 2>&1
#
# Expects:
#   - config.py and rx_tone.py in the same directory (/tmp/sdr/)
#   - USRP B210 connected via USB
#   - Desktop transmitting a tone via coax cable
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JSON_MODE=false
CAPTURE_DURATION=5
RESULT_FILE="/tmp/sdr-test-result.json"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)     JSON_MODE=true;        shift ;;
        --duration) CAPTURE_DURATION="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Step runner (same format as install.sh) ──────────────────────────────────

STEPS_JSON="[]"
OPERATION_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FAILED=false
TOTAL_STEPS=4

log() { echo "$@" >&2; }

escape_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

add_step() {
    local id="$1" name="$2" label="$3" status="$4" message="$5" duration="$6"
    local msg_escaped
    msg_escaped=$(escape_json "$message")

    local dur_field="$duration"
    [[ "$duration" == "null" ]] && dur_field="null"

    local msg_field
    [[ "$message" == "null" ]] && msg_field="null" || msg_field="\"$msg_escaped\""

    local step="{\"id\":$id,\"name\":\"$name\",\"label\":\"$label\",\"status\":\"$status\",\"message\":$msg_field,\"duration_s\":$dur_field}"

    if [[ "$STEPS_JSON" == "[]" ]]; then
        STEPS_JSON="[$step]"
    else
        STEPS_JSON="${STEPS_JSON%]}, $step]"
    fi
}

run_step() {
    local step_id="$1" step_name="$2" step_label="$3" step_func="$4"

    if [[ "$FAILED" == "true" ]]; then
        add_step "$step_id" "$step_name" "$step_label" "skipped" "null" "null"
        log "  [$step_id/$TOTAL_STEPS] $step_label — SKIPPED"
        return
    fi

    log "  [$step_id/$TOTAL_STEPS] $step_label..."

    local start_time end_time duration output
    start_time=$(date +%s%N)
    output=$($step_func 2>&1)
    local exit_code=$?
    end_time=$(date +%s%N)
    duration=$(echo "scale=1; ($end_time - $start_time) / 1000000000" | bc 2>/dev/null || echo "0")

    if [[ $exit_code -eq 0 ]]; then
        add_step "$step_id" "$step_name" "$step_label" "pass" "$output" "$duration"
        log "  [$step_id/$TOTAL_STEPS] $step_label — PASS ($output)"
    else
        add_step "$step_id" "$step_name" "$step_label" "fail" "$output" "$duration"
        log "  [$step_id/$TOTAL_STEPS] $step_label — FAIL: $output"
        FAILED=true
    fi
}

# ── Step functions ───────────────────────────────────────────────────────────

RX_RESULT=""

step_init_receiver() {
    # Check UHD and B210 are available
    if ! command -v uhd_find_devices &>/dev/null; then
        echo "UHD tools not found"
        return 1
    fi

    local devices
    devices=$(uhd_find_devices 2>/dev/null | grep -c "type: b200" || true)
    if [[ "$devices" -lt 1 ]]; then
        echo "No B210 SDR detected"
        return 1
    fi

    # Check Python scripts exist
    if [[ ! -f "$SCRIPT_DIR/rx_tone.py" || ! -f "$SCRIPT_DIR/config.py" ]]; then
        echo "rx_tone.py or config.py not found in $SCRIPT_DIR"
        return 1
    fi

    echo "USRP B210 ready"
    return 0
}

step_capture_samples() {
    # Start receiver, let it run for CAPTURE_DURATION seconds, then stop it
    cd "$SCRIPT_DIR"

    # Start RX in background
    python3 rx_tone.py &
    local rx_pid=$!

    # Wait for capture duration
    sleep "$CAPTURE_DURATION"

    # Stop receiver gracefully
    kill -SIGINT "$rx_pid" 2>/dev/null
    wait "$rx_pid" 2>/dev/null

    echo "Captured ${CAPTURE_DURATION}s of samples"
    return 0
}

step_analyze_spectrum() {
    # The rx_tone.py already ran analysis and wrote JSON to stdout.
    # We need to capture its output. Let's re-run with a different approach:
    # Actually, we combine capture + analysis in one step since rx_tone.py
    # does both. Let's read the result from the capture step.

    # Re-run rx_tone.py with a timeout to capture its JSON output
    cd "$SCRIPT_DIR"

    local output
    output=$(timeout "$((CAPTURE_DURATION + 5))" bash -c '
        python3 rx_tone.py &
        rx_pid=$!
        sleep '"$CAPTURE_DURATION"'
        kill -SIGINT $rx_pid 2>/dev/null
        wait $rx_pid 2>/dev/null
    ' 2>/dev/null)

    # Actually the JSON goes to stdout of rx_tone.py which is captured by the subshell
    # Let's use a temp file approach instead
    echo "Spectrum analysis complete"
    return 0
}

step_run_test() {
    # Combined capture + analysis: run rx_tone.py, wait, stop, get JSON
    cd "$SCRIPT_DIR"

    local json_out="/tmp/sdr-rx-result.json"
    rm -f "$json_out"

    # Run RX, capture stdout (JSON) to file, stderr goes to our stderr
    python3 rx_tone.py > "$json_out" 2>&1 &
    local rx_pid=$!

    # Wait for capture
    sleep "$CAPTURE_DURATION"

    # Stop gracefully
    kill -SIGINT "$rx_pid" 2>/dev/null

    # Wait for process to finish (timeout 10s)
    local waited=0
    while kill -0 "$rx_pid" 2>/dev/null && [[ $waited -lt 10 ]]; do
        sleep 1
        waited=$((waited + 1))
    done
    kill -9 "$rx_pid" 2>/dev/null
    wait "$rx_pid" 2>/dev/null

    if [[ ! -f "$json_out" || ! -s "$json_out" ]]; then
        echo "No output from receiver"
        return 1
    fi

    # Extract JSON (last line that starts with {)
    RX_RESULT=$(grep '^{' "$json_out" | tail -1)
    if [[ -z "$RX_RESULT" ]]; then
        echo "No JSON result from receiver"
        return 1
    fi

    echo "Captured and analyzed ${CAPTURE_DURATION}s of RF samples"
    return 0
}

step_validate_results() {
    if [[ -z "$RX_RESULT" ]]; then
        echo "No test results to validate"
        return 1
    fi

    # Parse the rx_tone.py JSON result
    local status snr freq_error peak_freq
    status=$(echo "$RX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
    snr=$(echo "$RX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['snr_db'])" 2>/dev/null)
    freq_error=$(echo "$RX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['freq_error_hz'])" 2>/dev/null)
    peak_freq=$(echo "$RX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['peak_freq_hz'])" 2>/dev/null)

    if [[ "$status" == "PASS" ]]; then
        echo "SNR: ${snr} dB, Freq error: ${freq_error} Hz, Peak: ${peak_freq} Hz"
        return 0
    else
        echo "SNR: ${snr} dB, Freq error: ${freq_error} Hz — below threshold"
        return 1
    fi
}

# ── Execute ──────────────────────────────────────────────────────────────────

log "====================================="
log "SDR Validation Test"
log "====================================="

run_step 1 "init_receiver"     "Initialize SDR receiver"  step_init_receiver
run_step 2 "run_test"          "Capture and analyze RF"    step_run_test
run_step 3 "validate_results"  "Validate results"         step_validate_results

# Build final JSON with SDR metrics embedded
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
overall="pass"
[[ "$FAILED" == "true" ]] && overall="fail"

# Merge rx_tone result into our output
local_metrics=""
if [[ -n "$RX_RESULT" ]]; then
    local_metrics=",\"metrics\":$RX_RESULT"
fi

json="{\"operation\":\"sdr_test\",\"started_at\":\"$OPERATION_START\",\"finished_at\":\"$finished_at\",\"result\":\"$overall\"$local_metrics,\"steps\":$STEPS_JSON}"

echo "$json" > "$RESULT_FILE"
if [[ "$JSON_MODE" == "true" ]]; then
    echo "$json"
fi

if [[ "$FAILED" == "true" ]]; then
    log "====================================="
    log "SDR TEST FAILED"
    log "====================================="
    exit 1
else
    log "====================================="
    log "SDR TEST PASSED"
    log "====================================="
    exit 0
fi
