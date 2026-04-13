# T3-Shield Firmware Installer — Debugging Guide

Systematic steps to diagnose unexplained errors. Work through each layer from bottom to top until you find the problem.

---

## Quick Reference: Where Are the Logs?

| Component | How to see logs |
|-----------|----------------|
| Frontend (browser) | F12 → Console tab |
| Frontend (container) | `docker logs -f t3s-frontend` |
| Backend (service) | `sudo journalctl -u t3s-backend -f` |
| Backend (last 100 lines) | `sudo journalctl -u t3s-backend -n 100 --no-pager` |
| Pi SSH session | `ssh dragon@192.168.137.100` then inspect manually |
| Pi firmware container | `ssh dragon@192.168.137.100 "sudo docker logs t3shield-firmware"` |
| Pi system log | `ssh dragon@192.168.137.100 "journalctl -n 50 --no-pager"` |

---

## Layer 1: Is Everything Running?

Run these three checks first. Most "unexplained" errors are just a service that's down.

### 1.1 Backend

```bash
sudo systemctl status t3s-backend
```

**Healthy:** `Active: active (running)`

If stopped or failed:
```bash
sudo journalctl -u t3s-backend -n 30 --no-pager
sudo systemctl restart t3s-backend
```

### 1.2 Frontend

```bash
docker ps | grep t3s-frontend
```

**Healthy:** shows a running container with `Up X minutes`

If not running:
```bash
docker ps -a | grep t3s-frontend   # check if it exited
docker logs t3s-frontend            # see why
docker restart t3s-frontend
```

### 1.3 Health endpoint

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

**Healthy:** `{"status": "ok", "version": "1.0.0"}`

If this fails, the backend is down or port 8000 is blocked. Check:
```bash
sudo lsof -i :8000
```

---

## Layer 2: Can the Desktop Reach the Pi?

### 2.1 Network

```bash
ping -c 3 192.168.137.100
```

If no response:
```bash
# Check desktop has the right IP
ip addr show | grep 192.168.137

# If missing, the Ethernet connection isn't configured
ETH=$(ip -o link show | grep -E 'eth|enp|ens' | head -1 | awk -F: '{print $2}' | tr -d ' ')
echo "Ethernet interface: $ETH"
nmcli con show "Pi-Ethernet" 2>/dev/null || echo "Pi-Ethernet connection not found"

# Check cable is physically connected
ip link show "$ETH" | grep "state UP"
```

### 2.2 SSH

```bash
ssh -o ConnectTimeout=5 dragon@192.168.137.100 "echo OK"
```

If it hangs: network issue (go back to 2.1).
If "Permission denied": wrong password. Try `Sensthings@012`.
If "Connection refused": SSH server not running on Pi:
```bash
ssh dragon@192.168.137.100 "sudo systemctl status sshd"
```

### 2.3 SSH with verbose output

If SSH connects but something feels wrong:
```bash
ssh -v dragon@192.168.137.100 "hostname && docker --version && uptime"
```

This tells you: is the Pi responding, is Docker installed, how long it's been up.

---

## Layer 3: Backend Logs During an Operation

The most useful debugging step. Start a live log, then trigger the operation from the browser.

### 3.1 Watch backend logs in real time

**Terminal 1:**
```bash
sudo journalctl -u t3s-backend -f
```

**Terminal 2 (or browser):** Start the install or SDR test.

Watch the logs for errors. Common patterns:

| Log message | Meaning |
|-------------|---------|
| `paramiko.ssh_exception.AuthenticationException` | Wrong SSH credentials in Settings |
| `paramiko.ssh_exception.NoValidConnectionsError` | Pi unreachable (network issue) |
| `socket.timeout` | Pi is slow or hanging (check Pi health) |
| `FileNotFoundError: docker` | Docker not installed on desktop (for firmware cache) |
| `subprocess.CalledProcessError` | A shell command failed (docker pull, uhd_find_devices, etc.) |
| `json.JSONDecodeError` | install.sh output wasn't valid JSON (script crashed mid-way) |
| `Permission denied` on SFTP upload | Pi user can't write to `/tmp/` (very rare) |

### 3.2 Check a specific install/test result

The backend stores results in memory for 60 seconds. If you know the `install_id` or `test_id` (from the browser console), you can hit the progress endpoint directly:

```bash
curl -s http://localhost:8000/install/<install_id>/progress
```

---

## Layer 4: What's Happening on the Pi?

SSH in and inspect.

### 4.1 Quick health check

```bash
ssh dragon@192.168.137.100
hostname                          # Should be T3S-<serial>
df -h /                           # Disk space
free -h                           # Memory
sudo docker ps                    # Running containers
sudo docker logs t3shield-firmware --tail 20  # Firmware container logs
```

### 4.2 Check if install.sh ran and what it produced

```bash
# Was the script uploaded?
ls -la /tmp/install.sh

# Was the firmware uploaded?
ls -lh /tmp/firmware.tar

# Was Docker installed?
docker --version

# Is the firmware container running?
sudo docker ps -a | grep t3shield
```

### 4.3 Re-run install.sh manually (for debugging)

```bash
sudo bash /tmp/install.sh --image-tar /tmp/firmware.tar --hostname T3S-DEBUG --json 2>&1
```

This shows all 13 steps with their output directly in the terminal. You'll see exactly which step fails and why.

### 4.4 Check firmware container health

```bash
# Is the API responding?
curl -s http://localhost:8080/api/system/ping

# SDR status
curl -s http://localhost:8080/api/sdr/status | python3 -m json.tool

# Container resource usage
sudo docker stats t3shield-firmware --no-stream
```

### 4.5 Check Pi's SDR

```bash
# Is the B210 detected?
uhd_find_devices 2>&1 | head -20

# If not found, check USB
lsusb | grep -i ettus
# or
lsusb | grep "2500:"
```

If the SDR isn't detected:
- Unplug and replug the USB cable
- Wait 10 seconds (FPGA initialization)
- Try `uhd_find_devices` again

---

## Layer 5: SDR Test Debugging

SDR test issues are usually hardware-related.

### 5.1 Desktop side (transmitter)

```bash
# Is the desktop B210 detected?
uhd_find_devices 2>&1 | head -20

# Is UHD installed?
which uhd_find_devices || echo "UHD not installed — run: sudo apt install uhd-host"

# Where are UHD images?
ls /usr/share/uhd/images/ 2>/dev/null || ls /usr/local/share/uhd/images/ 2>/dev/null || echo "UHD images not found"
```

### 5.2 Run TX manually

```bash
cd /opt/t3s-installer/backend/app/assets/sdr
python3 tx_tone.py
```

Should print UHD initialization messages then "Streaming...". Ctrl+C to stop.

If it crashes: UHD driver issue, missing images, or SDR not connected.

### 5.3 Run RX manually on the Pi

```bash
ssh dragon@192.168.137.100
cd /tmp/sdr
python3 rx_tone.py
```

Wait for "Streaming..." (can take 15-20 seconds for FPGA load), then Ctrl+C after 5 seconds. It should print a JSON result with SNR and frequency metrics.

### 5.4 Common SDR failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No B210 found" on desktop | USB disconnected or driver issue | Replug USB, check `lsusb` |
| "No B210 found" on Pi | USB disconnected | Replug USB on Pi side |
| TX starts but test fails | RF signal not reaching Pi SDR | Check both SDRs have antennas, check distance |
| SNR too low (< 15 dB) | Weak signal, interference, or bad antenna | Move SDRs closer, check antenna connections |
| Freq error > 5 kHz | SDR clock drift | Retry — usually transient |
| "FPGA image not found" | UHD images not installed | `sudo uhd_images_downloader` on the Pi |
| Timeout at "Initialiser le récepteur" | FPGA takes too long to load | Wait and retry — Pi can take 15-20s |

---

## Layer 6: Browser / Frontend Debugging

### 6.1 Open browser dev tools

Press **F12** → **Console** tab.

Look for:
- Red errors (JavaScript exceptions)
- Failed network requests (switch to **Network** tab)
- SSE connection status (filter by "EventSource" or look for `/progress` requests)

### 6.2 Check SSE stream directly

Open a new browser tab and go to:
```
http://localhost:8000/install/<install_id>/progress
```

You'll see raw SSE events streaming. This bypasses the frontend entirely — useful to confirm the backend is sending events correctly.

### 6.3 Check API responses directly

```bash
# Test SSH connection
curl -s -X POST http://localhost:8000/settings/test \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.137.100","username":"dragon","password":"Sensthings@012"}' | python3 -m json.tool

# Test GHCR
curl -s -X POST http://localhost:8000/settings/test-ghcr \
  -H "Content-Type: application/json" \
  -d '{"username":"elmoadin","token":"ghp_..."}' | python3 -m json.tool

# Check cache status
curl -s http://localhost:8000/cache | python3 -m json.tool

# Load checklist
curl -s http://localhost:8000/checklist | python3 -m json.tool
```

### 6.4 Settings lost or wrong

If the app behaves strangely after a browser update or cache clear:

1. Open F12 → **Application** tab → **Local Storage** → `http://localhost:3000`
2. Check `t3shield-installer-settings` — are SSH/GHCR credentials present?
3. Check `t3shield-auth` — is the login session present?
4. If empty: re-login and re-configure Settings

---

## Layer 7: Firmware Cache Issues

### 7.1 Check cache status

```bash
curl -s http://localhost:8000/cache | python3 -m json.tool
```

Shows: `docker_binaries` (bool), `firmware_image` (bool), `firmware_tag` (string or null).

### 7.2 Inspect cache files

```bash
ls -lh ~/.t3s-installer/cache/
```

Expected:
```
docker-static.tgz          ~60 MB
docker-static/              directory with binaries
firmware.tar                400 MB - 1 GB
firmware-version.txt        image URI
firmware-digest.txt         manifest digest
```

### 7.3 Inspect operation logs

```bash
# List recent logs
ls -lt ~/.t3s-installer/logs/install/ | head
ls -lt ~/.t3s-installer/logs/sdr-test/ | head
ls -lt ~/.t3s-installer/logs/antenna-test/ | head

# View latest log (full config, metrics, diagnosis)
cat ~/.t3s-installer/logs/sdr-test/$(ls -t ~/.t3s-installer/logs/sdr-test/ | head -1) | python3 -m json.tool
```

### 7.4 Clear and rebuild cache

```bash
# Via API
curl -s -X DELETE http://localhost:8000/cache

# Or manually
rm -rf ~/.t3s-installer/cache/firmware*
```

Next install will re-download the firmware image.

### 7.4 Docker pull fails on desktop

```bash
# Check Docker is running
docker info

# Check GHCR login
echo "YOUR_TOKEN" | docker login ghcr.io -u elmoadin --password-stdin

# Try pulling manually
docker pull ghcr.io/sensthings/t3shield-firmware:latest
```

If login fails: token expired. Generate a new one at https://github.com/settings/tokens.

---

## Debugging Flowchart

When you get an unexplained error, follow this order:

```
1. Is everything running?
   Backend: sudo systemctl status t3s-backend
   Frontend: docker ps | grep t3s-frontend
   ↓ both running?

2. Can backend reach Pi?
   curl -s -X POST http://localhost:8000/settings/test ...
   ↓ SSH works?

3. Watch backend logs + retry
   sudo journalctl -u t3s-backend -f
   (trigger the operation from browser)
   ↓ error visible in logs?

4. SSH into Pi and inspect
   ssh dragon@192.168.137.100
   Check: disk space, Docker, container, /tmp/ files
   ↓ Pi looks healthy?

5. Re-run the script manually on Pi
   sudo bash /tmp/install.sh --image-tar /tmp/firmware.tar --hostname T3S-DEBUG --json 2>&1
   ↓ which step fails?

6. Check browser console (F12)
   Network tab: are requests failing?
   Console: JavaScript errors?
   ↓ frontend issue?

7. Clear cache and retry
   curl -X DELETE http://localhost:8000/cache
   (retry from browser)
```

---

## Collecting a Debug Report

If you can't solve it and need to escalate, collect:

```bash
echo "=== Version ===" && cat /opt/t3s-installer/VERSION
echo "=== Backend status ===" && sudo systemctl status t3s-backend --no-pager
echo "=== Backend logs (last 50) ===" && sudo journalctl -u t3s-backend -n 50 --no-pager
echo "=== Frontend status ===" && docker ps -a | grep t3s-frontend
echo "=== Frontend logs (last 20) ===" && docker logs t3s-frontend --tail 20 2>&1
echo "=== Network ===" && ip addr show | grep 192.168.137
echo "=== Ping Pi ===" && ping -c 2 192.168.137.100 2>&1
echo "=== Cache ===" && curl -s http://localhost:8000/cache 2>&1
echo "=== Health ===" && curl -s http://localhost:8000/health 2>&1
echo "=== Disk ===" && df -h / ~/.t3s-installer/ 2>&1
echo "=== Latest operation logs ===" && ls -lt ~/.t3s-installer/logs/install/ 2>/dev/null | head -3 && ls -lt ~/.t3s-installer/logs/sdr-test/ 2>/dev/null | head -3
echo "=== Docker ===" && docker info 2>&1 | head -5
```

Copy the output and send it with the error description.
