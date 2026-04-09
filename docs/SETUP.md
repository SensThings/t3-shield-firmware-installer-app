# T3-Shield Firmware Installer — Desktop Setup Guide

How to install, configure, and maintain the installer on technician desktops.

---

## Requirements

| Item | Details |
|------|---------|
| Desktop OS | Dragon OS or Ubuntu 22.04+ (x86_64) |
| Internet | Required for first install (downloads Docker, firmware image). Not needed after. |
| Ethernet port | For connecting to Pi (direct cable, no switch needed) |
| USB port | For B210 SDR (only needed for SDR test, not for programming) |
| Browser | Any modern browser (Chrome, Firefox, Edge) |

---

## First-Time Installation

### 1. Copy the install script to the desktop

Transfer `deploy/t3s-install.sh` to the desktop (USB drive, SCP, etc.).

### 2. Run the installer

```bash
sudo bash t3s-install.sh
```

This script does everything:
- Installs Docker (if missing)
- Installs Python 3 + pip
- Clones the backend from GitHub
- Creates a systemd service for the backend (`t3s-backend`)
- Pulls and starts the frontend Docker container (`t3s-frontend`)
- Configures the Ethernet adapter for Pi connection (`192.168.137.1/24`)
- Sets up USB udev rules for the B210 SDR

### 3. Verify

Open a browser to **http://localhost:3000**

You should see the login page. Login with:
- Username: `op`
- Password: `123`

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

## Configuration

### First-time settings

After logging in, click the gear icon (Paramètres) and configure:

| Setting | Value | Notes |
|---------|-------|-------|
| Adresse IP | `192.168.137.100` | Default, change only if Pi has different IP |
| Utilisateur SSH | `dragon` | Default Dragon OS user |
| Mot de passe SSH | `Sensthings@012` | Default password |
| Utilisateur GHCR | Your GitHub username | Needs `read:packages` access to `ghcr.io/sensthings` |
| Jeton GHCR | GitHub PAT | Token with `read:packages` scope |
| Image firmware | `ghcr.io/sensthings/t3shield-firmware:latest` | Change to pin a specific version |

Click **Tester la connexion** to verify SSH works.
Click **Tester GHCR** to verify registry access.
Click **Enregistrer** to save.

Settings are stored in the browser's localStorage.

---

## Updating

When a new version is pushed to GitHub:

```bash
sudo bash /opt/t3s-installer/t3s-update.sh
```

This:
1. Re-clones the backend code from GitHub
2. Restarts the backend service
3. Pulls the latest frontend Docker image
4. Restarts the frontend container

Then refresh the browser.

### Update the firmware image only

If only the firmware image changed (not the installer app):

1. Open Settings in the browser
2. Click **Rafraichir l'image**
3. Program the next device — the new image will be downloaded and cached

---

## Service Management

### Backend (systemd)

```bash
# Status
sudo systemctl status t3s-backend

# Restart
sudo systemctl restart t3s-backend

# Logs
sudo journalctl -u t3s-backend -f
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
8. Wait for all 18 steps to complete (typically 5-10 minutes)
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

- Check the Ethernet cable is connected
- Check the Pi is powered on (green LED)
- Verify the desktop Ethernet IP is `192.168.137.1/24`:
  ```bash
  ip addr show | grep 192.168.137
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
  sudo rm -f /usr/local/bin/docker*
  sudo rm -f /usr/local/bin/containerd*
  ```
- Retry the install

### Install fails at "Télécharger l'image firmware"

- Check the GHCR token is valid (Settings → Tester GHCR)
- Clear the cache (Settings → Rafraichir l'image) and retry
- Check Docker is running on the desktop:
  ```bash
  docker info
  ```

### Install fails at "Vérification de santé"

- The firmware container started but isn't responding
- SSH into the Pi and check:
  ```bash
  ssh dragon@192.168.137.100
  sudo docker logs t3shield-firmware
  ```

### SDR test fails at "Vérifier le SDR du poste"

- The desktop B210 SDR is not detected
- Check USB connection
- Verify UHD tools are installed:
  ```bash
  uhd_find_devices
  ```

### SDR test fails at "Initialiser le récepteur SDR"

- The Pi's B210 SDR is not detected
- Unplug and replug the SDR USB cable on the Pi
- Retry the test

### Backend won't start

```bash
sudo journalctl -u t3s-backend -n 50
```

Common causes:
- Python dependencies missing → `cd /opt/t3s-installer/backend && pip install -r requirements.txt`
- Port 8000 already in use → `sudo lsof -i :8000`

### Frontend shows blank page

```bash
docker logs t3s-frontend
```

Common causes:
- Port 3000 already in use
- Backend not running (frontend can't reach `localhost:8000`)

---

## File Locations on Desktop

| Path | Contents |
|------|----------|
| `/opt/t3s-installer/backend/` | Backend source code |
| `/opt/t3s-installer/t3s-update.sh` | Update script |
| `~/.t3shield-installer/` | Firmware cache (Docker binaries, firmware tar) |
| Browser localStorage | SSH settings, GHCR credentials, auth state |
