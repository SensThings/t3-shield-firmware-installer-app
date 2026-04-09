#!/bin/bash
# =============================================================================
# SDR Validation Test — Receiver Side
# =============================================================================
# Runs on the target device via SSH. The desktop runs the transmitter.
#
# Usage:
#   bash /tmp/sdr/test.sh --duration 5 --json 2>&1
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
TOTAL_STEPS=3

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
    local start_time end_time duration
    start_time=$(date +%s%N)

    # Run step, capture only the LAST line as the message
    # UHD dumps lots of info to stderr which we don't want as the step message
    local msg_file="/tmp/sdr-step-msg.txt"
    $step_func > "$msg_file" 2>/dev/null
    local exit_code=$?
    local output
    output=$(tail -1 "$msg_file" 2>/dev/null || echo "")

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
    # Check Python scripts exist
    if [[ ! -f "$SCRIPT_DIR/rx_tone.py" || ! -f "$SCRIPT_DIR/config.py" ]]; then
        echo "rx_tone.py or config.py not found in $SCRIPT_DIR"
        return 1
    fi

    # Set UHD images path
    local uhd_dir
    uhd_dir=$(find /usr/share/uhd /usr/local/share/uhd /opt/uhd/share/uhd -name images -type d 2>/dev/null | head -1)
    if [[ -n "$uhd_dir" ]]; then
        export UHD_IMAGES_DIR="$uhd_dir"
    fi

    # Quick check for B210 (allow UHD info output to go to /dev/null)
    local devices
    devices=$(uhd_find_devices 2>/dev/null | grep -c "type: b200" || echo 0)
    if [[ "$devices" -lt 1 ]]; then
        echo "No B210 SDR detected"
        return 1
    fi

    echo "USRP B210 ready"
    return 0
}

step_run_test() {
    cd "$SCRIPT_DIR"

    local json_out="/tmp/sdr-rx-result.json"
    local rx_log="/tmp/sdr-rx-stderr.log"
    rm -f "$json_out" "$rx_log"

    # Set UHD images path
    local uhd_dir
    uhd_dir=$(find /usr/share/uhd /usr/local/share/uhd /opt/uhd/share/uhd -name images -type d 2>/dev/null | head -1)
    if [[ -n "$uhd_dir" ]]; then
        export UHD_IMAGES_DIR="$uhd_dir"
    fi

    # Run RX: stdout (JSON) → file, stderr (UHD logs) → separate log
    python3 rx_tone.py > "$json_out" 2>"$rx_log" &
    local rx_pid=$!

    # Wait for RX to start streaming (FPGA load can take 15-20s on Pi)
    local init_waited=0
    while [[ $init_waited -lt 30 ]]; do
        if grep -q "Streaming" "$rx_log" 2>/dev/null; then
            log "  [RX] Streaming started after ${init_waited}s"
            break
        fi
        if ! kill -0 "$rx_pid" 2>/dev/null; then
            log "  [RX] Process died during init"
            break
        fi
        sleep 1
        init_waited=$((init_waited + 1))
    done

    if [[ $init_waited -ge 30 ]]; then
        log "  [RX] Init timed out after 30s"
        kill -9 "$rx_pid" 2>/dev/null
        wait "$rx_pid" 2>/dev/null
        echo "SDR receiver initialization timed out (FPGA load)"
        return 1
    fi

    # NOW capture for the specified duration
    sleep "$CAPTURE_DURATION"

    # Stop gracefully with SIGINT (triggers analysis in rx_tone.py)
    kill -INT "$rx_pid" 2>/dev/null

    # Wait for process to finish analysis and write JSON (timeout 15s)
    local waited=0
    while kill -0 "$rx_pid" 2>/dev/null && [[ $waited -lt 15 ]]; do
        sleep 1
        waited=$((waited + 1))
    done
    kill -9 "$rx_pid" 2>/dev/null
    wait "$rx_pid" 2>/dev/null

    # Debug: show what we got
    log "  [RX stderr]: $(tail -3 "$rx_log" 2>/dev/null)"
    log "  [RX stdout]: $(cat "$json_out" 2>/dev/null | head -3)"

    if [[ ! -f "$json_out" || ! -s "$json_out" ]]; then
        echo "No output from receiver (check $rx_log)"
        return 1
    fi

    # Extract JSON
    RX_RESULT=$(grep '^{' "$json_out" | tail -1)
    if [[ -z "$RX_RESULT" ]]; then
        RX_RESULT=$(cat "$json_out" | tr -d '\n' | grep -o '{.*}' | tail -1)
    fi
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

finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
overall="pass"
[[ "$FAILED" == "true" ]] && overall="fail"

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
