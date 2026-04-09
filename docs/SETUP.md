# T3-Shield Firmware Installer — Desktop Setup Guide

Step-by-step guide to install, configure, and maintain the installer app on technician desktops.

---

## Before You Start

### What you need to prepare

1. **A GitHub Personal Access Token (PAT)** with `read:packages` scope
   - Go to https://github.com/settings/tokens → Generate new token (classic)
   - Select scope: `read:packages`
   - Copy the token (starts with `ghp_...`) — you'll need it twice
   - The GitHub username is: `elmoadin`

2. **Network access** — the desktop needs internet for the first install (to download Docker, Python packages, and the firmware image). After that, it works offline.

4. **Desktop credentials** — you need `sudo` access on the desktop

5. **Physical setup per desktop:**
   - Ethernet cable (connects desktop to Pi)
   - B210 SDR connected via USB to the desktop (only needed for SDR testing, not for programming)

---

## Step 1: Copy the Install Script to the Desktop

From your machine (where you have the repo cloned), send the script via SCP:

```bash
scp deploy/t3s-install.sh <user>@<desktop-ip>:~/t3s-install.sh
```

Example:

```bash
scp deploy/t3s-install.sh st2@10.87.126.249:~/t3s-install.sh
```

Then SSH into the desktop:

```bash
ssh <user>@<desktop-ip>
```

Edit the script and replace the GHCR token placeholder:

```bash
nano ~/t3s-install.sh
```

Find this line near the top:

```
GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"
```

Replace `REPLACE_WITH_YOUR_GHCR_TOKEN` with your actual GitHub PAT. Save and close.

---

## Step 2: Run the Install Script

(Still on the desktop via SSH)

```bash
sudo bash ~/t3s-install.sh
```

The script runs 8 steps automatically:

| Step | What it does |
|------|-------------|
| 1/8 | Install Docker (if missing) |
| 2/8 | Install Python 3 + backend dependencies |
| 3/8 | Clone backend code from GitHub → `/opt/t3s-installer/backend/` |
| 4/8 | Pull and start frontend Docker container |
| 5/8 | Configure Ethernet adapter (`192.168.137.1/24`) |
| 6/8 | Set USB permissions for B210 SDR |
| 7/8 | Create desktop shortcuts |
| 8/8 | Verify backend + frontend are running |

### Important: Docker logout/login

If Docker was not previously installed, the script will install it and then **stop with this message:**

```
Docker installed. Please LOG OUT and LOG BACK IN, then run this script again.
```

This is required because Docker needs the user to be in the `docker` group, which only takes effect after a fresh login. **Log out of the desktop session, log back in, then run the script again.** The second run will skip Docker install and continue from step 2.

---

## Step 3: Verify the Installation

After the script finishes, two shortcuts appear on the desktop:

| Shortcut | What it does |
|----------|-------------|
| **T3-Shield Installateur** | Opens the app in the browser (http://localhost:3000) |
| **T3S Mise à jour** | Runs the update script (opens a terminal, asks for sudo password) |

The script also opens the browser automatically. If not, double-click "T3-Shield Installateur" or open:

**http://localhost:3000**

You should see the login page. Login with:
- Username: **op**
- Password: **123**

You can also verify the backend directly:

```bash
curl http://localhost:8000/health
```

Expected: `{"status":"ok","version":"1.0.0"}`

---

## Step 4: Configure Settings (First Time Per Browser)

This is **mandatory** — the app won't work without SSH and GHCR credentials.

After logging in, click the **gear icon** (top right) to open Settings.

Fill in:

| Setting | Value | Notes |
|---------|-------|-------|
| Adresse IP | `192.168.137.100` | Default — only change if Pi has a different IP |
| Utilisateur SSH | `dragon` | Default Dragon OS user on the Pi |
| Mot de passe SSH | `Sensthings@012` | Default password on the Pi |
| Utilisateur GHCR | `elmoadin` | GitHub username for container registry |
| Jeton GHCR | `ghp_...` | The same PAT you used in the install script |
| Image firmware | `ghcr.io/sensthings/t3shield-firmware:latest` | Default — change to pin a specific version |

Then:
1. Click **Tester la connexion** — should show a green checkmark (requires a Pi to be connected)
2. Click **Tester GHCR** — should show a green checkmark
3. Click **Enregistrer**

Settings are saved in the browser's localStorage. If the browser cache is cleared, you'll need to re-enter them.

---

## Step 5: Edit the Update Script (One Time)

The update script also needs the GHCR token. Edit it:

```bash
nano /opt/t3s-installer/t3s-update.sh
```

Find `GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"` and replace with the same PAT. Save.

This only needs to be done once per desktop.

---

## Setting Up Multiple Desktops

If you're setting up 10+ desktops, here's the efficient workflow:

1. **Prepare once (on your machine):**
   - Edit `deploy/t3s-install.sh` with the real GHCR token
   - Save it — you'll SCP the same file to every desktop

2. **Per desktop:**
   ```bash
   # Copy script
   scp deploy/t3s-install.sh <user>@<desktop-ip>:~/t3s-install.sh
   # SSH in and run
   ssh <user>@<desktop-ip>
   sudo bash ~/t3s-install.sh
   ```
   - If Docker wasn't installed: logout/login, run again
   - Open browser → login → configure Settings → save
   - Edit `/opt/t3s-installer/t3s-update.sh` with the GHCR token
   - Connect a Pi, program one device to verify everything works
   - Move to next desktop

3. **Estimated time per desktop:** 10-15 minutes (mostly waiting for Docker/firmware download). Faster if the desktop already has Docker.

---

## Updating

### Check current version

The version is visible in two places:
- **Browser:** shown in the header next to "T3-Shield — Installateur" (e.g. `v1.0.0`)
- **Backend API:** `curl http://localhost:8000/health` → `{"status": "ok", "version": "1.0.0"}`

### Check if an update is available

```bash
bash /opt/t3s-installer/t3s-update.sh --check
```

Output: `Current version: v1.0.0` / `Latest version: v1.1.0` / `Update available.`

### Update to latest

```bash
sudo bash /opt/t3s-installer/t3s-update.sh
```

This:
1. Compares current vs latest version
2. Re-clones the backend code from GitHub
3. Restarts the backend service
4. Pulls the latest frontend Docker image
5. Restarts the frontend container
6. Shows: `v1.0.0 → v1.1.0`

Then refresh the browser.

### Update to a specific version

```bash
sudo bash /opt/t3s-installer/t3s-update.sh v1.0.0
```

### Force update (even if already on latest)

```bash
sudo bash /opt/t3s-installer/t3s-update.sh --force
```

### Update the firmware image only

If only the firmware image changed (not the installer app):

1. Open Settings in the browser
2. Click **Rafraichir l'image**
3. Program the next device — the new image will be downloaded and cached

### Updating all desktops at once

You can SSH into each desktop remotely:

```bash
for host in 10.87.126.249 10.87.126.250 10.87.126.251; do
  echo "Updating $host..."
  ssh user@$host "sudo bash /opt/t3s-installer/t3s-update.sh" &
done
wait
echo "All desktops updated."
```

---

## Network Setup

The desktop connects to the Pi via a direct Ethernet cable. The install script configures this automatically, but if you need to set it up manually:

### Desktop Ethernet (static IP)

```
IP: 192.168.137.1
Netmask: 255.255.255.0
Gateway: (none)
```

On Dragon OS / Ubuntu:

```bash
sudo nmcli connection add type ethernet \
  con-name "Pi-Ethernet" \
  ifname eth0 \
  ipv4.addresses 192.168.137.1/24 \
  ipv4.method manual
```

Replace `eth0` with your actual Ethernet interface name (`ip link show` to list).

### Pi (expected)

The Pi should already be configured with:

```
IP: 192.168.137.100
User: dragon
Password: Sensthings@012
```

---

## Service Management

### Backend (systemd)

```bash
# Status
sudo systemctl status t3s-backend

# Restart
sudo systemctl restart t3s-backend

# Logs (live)
sudo journalctl -u t3s-backend -f

# Logs (last 50 lines)
sudo journalctl -u t3s-backend -n 50
```

### Frontend (Docker)

```bash
# Status
docker ps | grep t3s-frontend

# Restart
docker restart t3s-frontend

# Logs
docker logs -f t3s-frontend
```

---

## Daily Operation

### Programming a device

1. Connect Pi to desktop via Ethernet cable
2. Connect Pi to power, wait for green LED
3. Open http://localhost:3000
4. Login with `op` / `123`
5. Complete the pre-flight checklist (all items must be "Oui")
6. Enter the serial number from the device label
7. Click **Démarrer**
8. Wait for all 18 steps to complete (typically 5-10 minutes, first device is slower due to file caching)
9. If PASS: click **Appareil suivant** for the next device
10. If FAIL: check the error message, fix the issue, click **Réessayer**

### SDR Test

1. Connect the desktop's B210 SDR via USB
2. From the main screen, click **Tester le SDR**
3. Enter the serial number
4. Click **Démarrer**
5. Wait for the 6 test steps
6. PASS = SDR receiver is working correctly

---

## Troubleshooting

### "Appareil injoignable" (device unreachable)

- Check the Ethernet cable is connected at both ends
- Check the Pi is powered on (green LED visible)
- Verify the desktop Ethernet IP is `192.168.137.1/24`:
  ```bash
  ip addr show | grep 192.168.137
  ```
  If missing, re-run the network setup:
  ```bash
  ETH=$(ip -o link show | grep -E 'eth|enp|ens' | head -1 | awk -F: '{print $2}' | tr -d ' ')
  sudo nmcli con add type ethernet con-name "Pi-Ethernet" ifname "$ETH" ip4 192.168.137.1/24
  ```
- Try pinging the Pi:
  ```bash
  ping 192.168.137.100
  ```
- If ping works but SSH fails, try manually:
  ```bash
  ssh dragon@192.168.137.100
  ```

### Install fails at "Installer Docker"

- The Pi may already have a broken Docker install
- SSH into the Pi and clean up:
  ```bash
  ssh dragon@192.168.137.100
  sudo rm -f /usr/local/bin/docker* /usr/local/bin/containerd*
  sudo rm -f /etc/systemd/system/docker.service /etc/systemd/system/containerd.service
  sudo systemctl daemon-reload
  ```
- Retry the install

### Install fails at "Télécharger l'image firmware"

- Check the GHCR token is valid: Settings → **Tester GHCR**
- If it fails, the token may have expired — generate a new one at https://github.com/settings/tokens
- Clear the cache: Settings → **Rafraichir l'image** → retry
- Check Docker is running on the desktop:
  ```bash
  docker info
  ```

### Install fails at "Vérification de santé"

- The firmware container started but isn't responding
- SSH into the Pi and check the container logs:
  ```bash
  ssh dragon@192.168.137.100
  sudo docker logs t3shield-firmware
  ```
- If the container exited, check:
  ```bash
  sudo docker ps -a | grep t3shield
  ```

### SDR test fails at "Vérifier le SDR du poste"

- The desktop B210 SDR is not detected
- Check USB connection (try a different port)
- Verify UHD tools are installed:
  ```bash
  uhd_find_devices
  ```
- If not installed: `sudo apt install uhd-host`

### SDR test fails at "Initialiser le récepteur SDR"

- The Pi's B210 SDR is not detected
- Unplug and replug the SDR USB cable on the Pi
- Wait 10 seconds (FPGA initialization), then retry

### Backend won't start

```bash
sudo journalctl -u t3s-backend -n 50
```

Common causes:
- **Python dependencies missing:**
  ```bash
  cd /opt/t3s-installer/backend && pip3 install -r requirements.txt
  ```
- **Port 8000 already in use:**
  ```bash
  sudo lsof -i :8000
  ```

### Frontend shows blank page

```bash
docker logs t3s-frontend
```

Common causes:
- Port 3000 already in use
- Backend not running — the page loads but API calls fail. Check with:
  ```bash
  curl http://localhost:8000/health
  ```

### Settings lost after browser update

Settings are stored in localStorage. If the browser clears its data (update, privacy settings), you'll need to re-enter the SSH and GHCR credentials in Settings. This is by design — credentials are not stored on the server.

---

## File Locations on Desktop

| Path | Contents |
|------|----------|
| `/opt/t3s-installer/backend/` | Backend source code |
| `/opt/t3s-installer/t3s-update.sh` | Update script (contains GHCR token) |
| `/opt/t3s-installer/VERSION` | Current installed version |
| `~/.t3shield-installer/` | Firmware cache (Docker binaries, firmware tar) |
| Browser localStorage | SSH settings, GHCR credentials, auth state |
