#!/bin/bash
# =============================================================================
# T3-Shield Firmware — First-Time Device Setup
# =============================================================================
# Run on a FRESH Dragon OS Pi via SSH from the desktop install panel.
#
# Usage:
#   # ONLINE mode (Pi has internet):
#   GHCR_USER=<user> GHCR_TOKEN=<pat> bash install.sh [--json] [--hostname T3S-12345]
#
#   # OFFLINE mode (Pi has NO internet — image pushed via SCP):
#   bash install.sh --image-tar /tmp/firmware.tar [--json] [--hostname T3S-12345]
#
# Flags:
#   --json:       structured JSON result (stdout=JSON, stderr=progress)
#   --hostname:   set device hostname (e.g., T3S-<serial>)
#   --image-tar:  path to pre-transferred Docker image tar (offline mode)
#                 When set: skips network config, registry login, and docker pull.
#                 Uses `docker load` instead.
#   --gateway:    configure default route + DNS (online mode only)
#
# Environment variables (or CLI args):
#   GHCR_USER   — GitHub username for ghcr.io login (not needed in offline mode)
#   GHCR_TOKEN  — GitHub PAT with read:packages scope (not needed in offline mode)
#   IMAGE       — (optional) Full image ref (default: ghcr.io/sensthings/t3shield-firmware:latest)
# =============================================================================

set -uo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
IMAGE="${IMAGE:-ghcr.io/sensthings/t3shield-firmware:latest}"
CONTAINER_NAME="t3shield-firmware"
DATA_DIR="/data"
OPT_DIR="/opt/t3shield"
JSON_MODE=false
DEVICE_HOSTNAME=""
GATEWAY_IP=""
IMAGE_TAR=""
RESULT_FILE="/tmp/t3shield-install-result.json"

# ── Parse CLI args ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --ghcr-user)  GHCR_USER="$2";  shift 2 ;;
        --ghcr-token) GHCR_TOKEN="$2"; shift 2 ;;
        --image)      IMAGE="$2";          shift 2 ;;
        --hostname)   DEVICE_HOSTNAME="$2"; shift 2 ;;
        --gateway)    GATEWAY_IP="$2";       shift 2 ;;
        --image-tar)  IMAGE_TAR="$2";       shift 2 ;;
        --json)       JSON_MODE=true;        shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Validate inputs ──────────────────────────────────────────────────────────
if [[ -n "$IMAGE_TAR" ]]; then
    # Offline mode — validate tar exists
    if [[ ! -f "$IMAGE_TAR" ]]; then
        echo "ERROR: --image-tar file not found: $IMAGE_TAR" >&2
        exit 1
    fi
else
    # Online mode — need GHCR credentials
    if [[ -z "${GHCR_USER:-}" || -z "${GHCR_TOKEN:-}" ]]; then
        echo "ERROR: GHCR_USER and GHCR_TOKEN must be set (or use --image-tar for offline mode)" >&2
        exit 1
    fi
fi

# ── JSON Step Runner ─────────────────────────────────────────────────────────
# Builds a JSON array of step results incrementally.

STEPS_JSON="[]"
OPERATION_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FAILED=false
TOTAL_STEPS=13

log() {
    # Human-readable output goes to stderr so it doesn't pollute JSON on stdout
    echo "$@" >&2
}

escape_json() {
    # Escape special chars for JSON string values
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

    if [[ "$duration" == "null" ]]; then
        local dur_field="null"
    else
        local dur_field="$duration"
    fi

    if [[ "$message" == "null" ]]; then
        local msg_field="null"
    else
        local msg_field="\"$msg_escaped\""
    fi

    local step="{\"id\":$id,\"name\":\"$name\",\"label\":\"$label\",\"status\":\"$status\",\"message\":$msg_field,\"duration_s\":$dur_field}"

    # Append to JSON array
    if [[ "$STEPS_JSON" == "[]" ]]; then
        STEPS_JSON="[$step]"
    else
        STEPS_JSON="${STEPS_JSON%]}, $step]"
    fi
}

run_step() {
    local step_id="$1"
    local step_name="$2"
    local step_label="$3"
    local step_func="$4"

    if [[ "$FAILED" == "true" ]]; then
        add_step "$step_id" "$step_name" "$step_label" "skipped" "null" "null"
        log "  [$step_id/$TOTAL_STEPS] $step_label — SKIPPED"
        return
    fi

    log "  [$step_id/$TOTAL_STEPS] $step_label..."

    local start_time end_time duration
    start_time=$(date +%s%N)

    # Run the step function, capture output
    local output
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

emit_result() {
    local overall_result="pass"
    if [[ "$FAILED" == "true" ]]; then
        overall_result="fail"
    fi

    local finished_at
    finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Get firmware version if container is healthy
    local fw_version="null"
    if [[ "$FAILED" != "true" ]]; then
        local ver
        ver=$(curl -sf http://localhost:5000/api/system/version 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        if [[ -n "$ver" ]]; then
            fw_version="\"$ver\""
        fi
    fi

    local json="{\"operation\":\"install\",\"image\":\"$IMAGE\",\"version\":$fw_version,\"started_at\":\"$OPERATION_START\",\"finished_at\":\"$finished_at\",\"result\":\"$overall_result\",\"steps\":$STEPS_JSON}"

    # Write to file (always, for retrieval after SSH disconnect)
    echo "$json" > "$RESULT_FILE"

    # If JSON mode, output to stdout
    if [[ "$JSON_MODE" == "true" ]]; then
        echo "$json"
    fi
}

# ── Step Functions ───────────────────────────────────────────────────────────

step_set_hostname() {
    if [[ -z "$DEVICE_HOSTNAME" ]]; then
        echo "Skipped (no --hostname provided)"
        return 0
    fi
    # Set hostname persistently
    hostnamectl set-hostname "$DEVICE_HOSTNAME" 2>&1
    local rc=$?
    if [[ $rc -eq 0 ]]; then
        # Update /etc/hosts so hostname resolves locally
        if grep -q "127.0.1.1" /etc/hosts; then
            sed -i "s/127.0.1.1.*/127.0.1.1\t$DEVICE_HOSTNAME/" /etc/hosts
        else
            echo -e "127.0.1.1\t$DEVICE_HOSTNAME" >> /etc/hosts
        fi
        echo "Hostname set to $DEVICE_HOSTNAME"
        return 0
    else
        echo "Failed to set hostname"
        return 1
    fi
}

step_expand_partition() {
    # Expand root partition (partition 2) to fill the entire SD card.
    # Dragon OS ships with a 14.3GB root on a 64GB card — wastes ~44GB.
    # Must happen before Docker install since /var/lib/docker needs space.

    local disk="/dev/mmcblk0"
    local part="${disk}p2"

    # Check if the disk exists (we're on a Pi with SD card)
    if [[ ! -b "$disk" ]]; then
        echo "Skipped (no SD card at $disk)"
        return 0
    fi

    # Check current vs total size — skip if already within 95% of full
    local part_size_kb total_size_kb
    part_size_kb=$(df --output=size "$part" 2>/dev/null | tail -1 | tr -d ' ')
    total_size_kb=$(lsblk -bno SIZE "$disk" 2>/dev/null | head -1)
    if [[ -n "$part_size_kb" && -n "$total_size_kb" ]]; then
        total_size_kb=$((total_size_kb / 1024))
        # If partition is already >90% of disk, skip
        if (( part_size_kb * 100 / total_size_kb > 90 )); then
            echo "Partition already expanded ($(( part_size_kb / 1024 / 1024 ))GB)"
            return 0
        fi
    fi

    # Resize partition using parted (available on Dragon OS, growpart is not)
    parted "$disk" ---pretend-input-tty resizepart 2 100% Yes >/dev/null 2>&1
    local rc=$?

    if [[ $rc -ne 0 ]]; then
        echo "parted resizepart failed (exit $rc)"
        return 1
    fi

    # Resize filesystem to fill the expanded partition
    resize2fs "$part" >/dev/null 2>&1
    rc=$?

    if [[ $rc -ne 0 ]]; then
        echo "resize2fs failed (exit $rc)"
        return 1
    fi

    # Report new size
    local new_size_gb
    new_size_gb=$(df -BG --output=size "$part" 2>/dev/null | tail -1 | tr -d ' G')
    echo "Partition expanded to ${new_size_gb}GB"
    return 0
}

step_configure_network() {
    # In offline mode, no internet needed
    if [[ -n "$IMAGE_TAR" ]]; then
        echo "Offline mode — no internet required"
        return 0
    fi

    if [[ -z "$GATEWAY_IP" ]]; then
        # No gateway specified — check if we already have internet
        if curl -sf --connect-timeout 5 https://get.docker.com >/dev/null 2>&1; then
            echo "Internet already available"
            return 0
        fi
        echo "No internet and no --gateway provided. Use --image-tar for offline install."
        return 1
    fi

    # Find the active Ethernet interface (usually eth0)
    local eth_iface
    eth_iface=$(ip -o link show | grep -E 'eth[0-9]|enp|ens' | grep 'state UP' | head -1 | awk -F: '{print $2}' | tr -d ' ')
    if [[ -z "$eth_iface" ]]; then
        eth_iface="eth0"
    fi

    # Add default route via gateway
    ip route replace default via "$GATEWAY_IP" dev "$eth_iface" 2>/dev/null

    # Set DNS (use gateway as DNS if it's a NAT router, plus Google DNS as fallback)
    cat > /etc/resolv.conf <<DNSEOF
nameserver $GATEWAY_IP
nameserver 8.8.8.8
nameserver 8.8.4.4
DNSEOF

    # Verify internet connectivity
    local retries=3
    for i in $(seq 1 $retries); do
        if curl -sf --connect-timeout 5 https://get.docker.com >/dev/null 2>&1; then
            echo "Network configured via $GATEWAY_IP"
            return 0
        fi
        sleep 1
    done

    echo "Network configured but cannot reach internet via $GATEWAY_IP"
    return 1
}

step_docker_install() {
    if command -v docker &>/dev/null; then
        echo "Docker already installed"
        return 0
    fi

    # Method 1: Online install (Pi has internet)
    if curl -sf --connect-timeout 5 https://get.docker.com >/dev/null 2>&1; then
        curl -fsSL https://get.docker.com 2>/dev/null | sh >/dev/null 2>&1

    # Method 2: Offline install from static binaries (SCPed by installer app)
    elif [[ -f /tmp/docker-static/docker/dockerd ]]; then
        # Copy binaries to /usr/local/bin
        cp /tmp/docker-static/docker/* /usr/local/bin/ 2>&1
        chmod +x /usr/local/bin/docker* /usr/local/bin/containerd* /usr/local/bin/runc /usr/local/bin/ctr 2>/dev/null

        # Create docker group
        groupadd -f docker 2>/dev/null

        # Create systemd service for dockerd
        cat > /etc/systemd/system/docker.service <<'SVCEOF'
[Unit]
Description=Docker Application Container Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/local/bin/dockerd --containerd=/run/containerd/containerd.sock --iptables=false
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
RestartSec=5
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
Delegate=yes
KillMode=process

[Install]
WantedBy=multi-user.target
SVCEOF

        # Create containerd service
        cat > /etc/systemd/system/containerd.service <<'CTDEOF'
[Unit]
Description=containerd container runtime
After=network.target

[Service]
ExecStart=/usr/local/bin/containerd
Restart=always
RestartSec=5
Delegate=yes
KillMode=process

[Install]
WantedBy=multi-user.target
CTDEOF

        systemctl daemon-reload
        systemctl enable containerd docker >/dev/null 2>&1
        systemctl start containerd >/dev/null 2>&1
        sleep 2
        systemctl start docker >/dev/null 2>&1
    else
        echo "No internet and no Docker binaries at /tmp/docker-static/. Cannot install Docker."
        return 1
    fi

    # Verify Docker is working
    sleep 2
    if command -v docker &>/dev/null && docker info >/dev/null 2>&1; then
        echo "Docker installed"
        return 0
    elif command -v docker &>/dev/null; then
        # Docker binary exists but daemon might still be starting
        for i in $(seq 1 5); do
            sleep 2
            if docker info >/dev/null 2>&1; then
                echo "Docker installed"
                return 0
            fi
        done
        echo "Docker installed but daemon not responding"
        return 1
    else
        echo "Docker installation failed"
        return 1
    fi
}

step_create_dirs() {
    mkdir -p "$DATA_DIR/logs" "$DATA_DIR/scan_results" "$OPT_DIR" 2>&1
    if [[ -d "$DATA_DIR/logs" && -d "$DATA_DIR/scan_results" && -d "$OPT_DIR" ]]; then
        echo "Directories created"
        return 0
    else
        echo "Failed to create directories"
        return 1
    fi
}

step_write_config() {
    if [[ -f "$DATA_DIR/config.json" ]]; then
        echo "Config already exists"
        return 0
    fi
    cat > "$DATA_DIR/config.json" <<'CONFIGEOF'
{
    "server": {
        "host": "0.0.0.0",
        "port": 5000,
        "debug": false,
        "secret_key": "CHANGE-ME-PER-DEVICE"
    },
    "cors": {
        "enabled": true,
        "origins": "*"
    },
    "detection": {
        "timeout": 60,
        "max_duration": 300
    },
    "network": {
        "scan_timeout": 10,
        "connect_timeout": 30
    },
    "logging": {
        "log_file": "signal_log.json",
        "max_log_entries": 10000
    }
}
CONFIGEOF
    if [[ -f "$DATA_DIR/config.json" ]]; then
        echo "Default config written"
        return 0
    else
        echo "Failed to write config"
        return 1
    fi
}

step_registry_login() {
    if [[ -n "$IMAGE_TAR" ]]; then
        echo "Skipped (offline mode)"
        return 0
    fi
    local output
    output=$(echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin 2>&1)
    local rc=$?
    if [[ $rc -eq 0 ]]; then
        echo "Login succeeded"
        return 0
    else
        echo "Login failed: $output"
        return 1
    fi
}

step_pull_image() {
    if [[ -n "$IMAGE_TAR" ]]; then
        # Offline mode: load from tar
        local output
        output=$(docker load -i "$IMAGE_TAR" 2>&1)
        local rc=$?
        if [[ $rc -eq 0 ]]; then
            echo "Image loaded from tar"
            return 0
        else
            echo "Failed to load image: $output"
            return 1
        fi
    fi

    # Online mode: pull from registry
    local output
    output=$(docker pull "$IMAGE" 2>&1)
    local rc=$?
    if [[ $rc -eq 0 ]]; then
        echo "Image pulled"
        return 0
    else
        echo "Pull failed: $output"
        return 1
    fi
}

step_install_update_script() {
    cat > "$OPT_DIR/update.sh" <<'UPDATEEOF'
#!/bin/bash
set -uo pipefail
IMAGE="${IMAGE:-ghcr.io/sensthings/t3shield-firmware:latest}"
CONTAINER_NAME="t3shield-firmware"
JSON_MODE=false
RESULT_FILE="/tmp/t3shield-update-result.json"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --image) IMAGE="$2"; shift 2 ;;
        --json)  JSON_MODE=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

STEPS_JSON="[]"
OPERATION_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FAILED=false

log() { echo "$@" >&2; }

escape_json() {
    local s="$1"
    s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\r'/}"; s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

add_step() {
    local id="$1" name="$2" label="$3" status="$4" message="$5" duration="$6"
    local msg_escaped; msg_escaped=$(escape_json "$message")
    local dur_field="$duration"; [[ "$duration" == "null" ]] || dur_field="$duration"
    local msg_field; [[ "$message" == "null" ]] && msg_field="null" || msg_field="\"$msg_escaped\""
    local step="{\"id\":$id,\"name\":\"$name\",\"label\":\"$label\",\"status\":\"$status\",\"message\":$msg_field,\"duration_s\":${dur_field}}"
    [[ "$STEPS_JSON" == "[]" ]] && STEPS_JSON="[$step]" || STEPS_JSON="${STEPS_JSON%]}, $step]"
}

run_step() {
    local step_id="$1" step_name="$2" step_label="$3" step_func="$4" total="$5"
    if [[ "$FAILED" == "true" ]]; then
        add_step "$step_id" "$step_name" "$step_label" "skipped" "null" "null"
        log "  [$step_id/$total] $step_label — SKIPPED"; return
    fi
    log "  [$step_id/$total] $step_label..."
    local start_time end_time duration output
    start_time=$(date +%s%N)
    output=$($step_func 2>&1); local exit_code=$?
    end_time=$(date +%s%N)
    duration=$(echo "scale=1; ($end_time - $start_time) / 1000000000" | bc 2>/dev/null || echo "0")
    if [[ $exit_code -eq 0 ]]; then
        add_step "$step_id" "$step_name" "$step_label" "pass" "$output" "$duration"
        log "  [$step_id/$total] $step_label — PASS ($output)"
    else
        add_step "$step_id" "$step_name" "$step_label" "fail" "$output" "$duration"
        log "  [$step_id/$total] $step_label — FAIL: $output"
        FAILED=true
    fi
}

step_pull()  { docker pull "$IMAGE" >/dev/null 2>&1 && echo "Image pulled" || { echo "Pull failed"; return 1; }; }
step_stop()  { docker stop "$CONTAINER_NAME" >/dev/null 2>&1; docker rm "$CONTAINER_NAME" >/dev/null 2>&1; echo "Old container removed"; return 0; }
step_start() {
    local cid; cid=$(docker run -d --name "$CONTAINER_NAME" --privileged --network host \
        -v /data/logs:/app/logs -v /data/config.json:/app/config.json -v /data/scan_results:/app/scan_results \
        --restart unless-stopped "$IMAGE" 2>&1)
    [[ $? -eq 0 ]] && echo "Container started" || { echo "Start failed: $cid"; return 1; }
}
step_health() {
    for i in $(seq 1 30); do
        if curl -sf http://localhost:5000/api/system/ping >/dev/null 2>&1; then echo "Healthy"; return 0; fi
        sleep 2
    done
    echo "Health check timed out after 60s"; return 1
}
step_warmup() {
    curl -sf -X POST http://localhost:5000/api/sdr/warmup >/dev/null 2>&1 && echo "SDR warmup triggered" || { echo "SDR warmup failed"; return 1; }
}
step_sdr() {
    for i in $(seq 1 15); do
        local st; st=$(curl -sf http://localhost:5000/api/sdr/status 2>/dev/null | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        [[ "$st" == "ready" ]] && { echo "SDR ready"; return 0; }
        [[ "$st" == "error" ]] && { echo "SDR error"; return 1; }
        sleep 2
    done
    echo "SDR not ready within 30s"; return 1
}

log "T3-Shield Firmware — OTA Update"
log "Image: $IMAGE"
run_step 1 "pull_image"       "Pull latest image"    step_pull    6
run_step 2 "stop_old"         "Stop old container"   step_stop    6
run_step 3 "start_container"  "Start new container"  step_start   6
run_step 4 "health_check"     "Health check"         step_health  6
run_step 5 "sdr_warmup"       "SDR warmup"           step_warmup  6
run_step 6 "sdr_verify"       "Verify SDR status"    step_sdr     6

finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
overall="pass"; [[ "$FAILED" == "true" ]] && overall="fail"
fw_version="null"
if [[ "$FAILED" != "true" ]]; then
    ver=$(curl -sf http://localhost:5000/api/system/version 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    [[ -n "$ver" ]] && fw_version="\"$ver\""
fi
json="{\"operation\":\"update\",\"image\":\"$IMAGE\",\"version\":$fw_version,\"started_at\":\"$OPERATION_START\",\"finished_at\":\"$finished_at\",\"result\":\"$overall\",\"steps\":$STEPS_JSON}"
echo "$json" > "$RESULT_FILE"
[[ "$JSON_MODE" == "true" ]] && echo "$json"
[[ "$overall" == "pass" ]] && { log "UPDATE COMPLETE"; exit 0; } || { log "UPDATE FAILED"; exit 1; }
UPDATEEOF
    chmod +x "$OPT_DIR/update.sh"
    if [[ -x "$OPT_DIR/update.sh" ]]; then
        echo "Update script installed"
        return 0
    else
        echo "Failed to install update script"
        return 1
    fi
}

step_start_container() {
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1

    local cid
    cid=$(docker run -d \
        --name "$CONTAINER_NAME" \
        --privileged \
        --network host \
        -v /data/logs:/app/logs \
        -v /data/config.json:/app/config.json \
        -v /data/scan_results:/app/scan_results \
        --restart unless-stopped \
        "$IMAGE" 2>&1)
    local rc=$?

    if [[ $rc -eq 0 ]]; then
        echo "Container started"
        return 0
    else
        echo "Failed to start container: $cid"
        return 1
    fi
}

step_health_check() {
    for i in $(seq 1 30); do
        if curl -sf http://localhost:5000/api/system/ping >/dev/null 2>&1; then
            echo "Healthy"
            return 0
        fi
        sleep 2
    done
    echo "Health check timed out after 60s"
    return 1
}

step_sdr_warmup() {
    local response
    response=$(curl -sf -X POST http://localhost:5000/api/sdr/warmup 2>&1)
    local rc=$?
    if [[ $rc -eq 0 ]]; then
        echo "SDR warmup triggered"
        return 0
    else
        echo "SDR warmup request failed: $response"
        return 1
    fi
}

step_sdr_verify() {
    # Wait up to 30s for SDR to become ready
    for i in $(seq 1 15); do
        local response
        response=$(curl -sf http://localhost:5000/api/sdr/status 2>/dev/null)
        if [[ $? -eq 0 ]]; then
            local status
            status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            if [[ "$status" == "ready" ]]; then
                echo "SDR ready"
                return 0
            elif [[ "$status" == "error" ]]; then
                local msg
                msg=$(echo "$response" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
                echo "SDR error: $msg"
                return 1
            fi
        fi
        sleep 2
    done
    echo "SDR did not become ready within 30s"
    return 1
}

# ── Execute Steps ────────────────────────────────────────────────────────────

log "====================================="
log "T3-Shield Firmware — Device Setup"
log "====================================="
log "Image: $IMAGE"

run_step 1  "set_hostname"          "Set device hostname"      step_set_hostname
run_step 2  "expand_partition"     "Expand SD card partition" step_expand_partition
run_step 3  "configure_network"    "Configure network"        step_configure_network
run_step 4  "docker_install"        "Install Docker"           step_docker_install
run_step 5  "create_dirs"           "Create data directories"  step_create_dirs
run_step 6  "write_config"          "Write default config"     step_write_config
run_step 7  "registry_login"        "Login to registry"        step_registry_login
run_step 8  "pull_image"            "Pull firmware image"      step_pull_image
run_step 9  "install_update_script" "Install update script"    step_install_update_script
run_step 10 "start_container"       "Start container"          step_start_container
run_step 11 "health_check"          "Health check"             step_health_check
run_step 12 "sdr_warmup"            "SDR warmup"               step_sdr_warmup
run_step 13 "sdr_verify"            "Verify SDR status"        step_sdr_verify

emit_result

if [[ "$FAILED" == "true" ]]; then
    log "====================================="
    log "INSTALL FAILED"
    log "====================================="
    exit 1
else
    log "====================================="
    log "INSTALL COMPLETE"
    log "====================================="
    exit 0
fi
