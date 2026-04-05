# T3-Shield Firmware Installer — Setup & Test Guide

## Step 1: Clean the Raspberry Pi

SSH into the Pi and remove all existing T3-Shield software:

```bash
ssh sensthings@10.112.119.87
# password: 123456789
```

> If the username isn't `sensthings`, try `pi` or `root`.

Once connected, run:

```bash
# Stop and remove all Docker containers
sudo docker stop $(sudo docker ps -aq) 2>/dev/null
sudo docker rm $(sudo docker ps -aq) 2>/dev/null

# Remove all Docker images
sudo docker rmi $(sudo docker images -q) 2>/dev/null

# Remove T3-Shield data directories
sudo rm -rf /opt/t3shield /etc/t3shield /var/lib/t3shield

# Remove the install script if present
sudo rm -f /tmp/install.sh

# Reset hostname back to default
sudo hostnamectl set-hostname raspberrypi

# Verify clean state
echo "--- Docker containers ---"
sudo docker ps -a
echo "--- Docker images ---"
sudo docker images
echo "--- Hostname ---"
hostname

# Exit SSH
exit
```

---

## Step 2: Start the Installer App (Development Mode)

On your desktop machine:

```bash
cd ~/t3-shield/t3-shield-firmware-installer-app

# Install dependencies (skip if already done)
npm install

# Start the dev server
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Step 3: Start the Installer App (Docker Mode)

Alternative to dev mode — run as a Docker container:

```bash
cd ~/t3-shield/t3-shield-firmware-installer-app

# Build the image locally
docker build -t t3shield-installer .

# Run it (host networking so it can reach the Pi)
docker run -d --name t3shield-installer --network host t3shield-installer
```

Open http://localhost:3000 in your browser.

---

## Step 4: Configure Settings

1. Click the **gear icon** (top-right) in the app
2. Update these settings:

| Setting | Value |
|---------|-------|
| Device IP | `10.112.119.87` |
| SSH Username | `sensthings` (or whatever works) |
| SSH Password | `123456789` |
| GHCR Username | *(your GitHub username)* |
| GHCR Token | *(your GitHub PAT with `read:packages`)* |
| Firmware Image | `ghcr.io/sensthings/t3shield-firmware:latest` |

3. Click **Test Connection** — you should see a green checkmark
4. Click **Save**

---

## Step 5: Program the Device

1. Click **Program New Device**
2. Enter a serial number (e.g., `00001`)
3. Click **Start**
4. Watch the 11-step progress checklist in real time
5. Wait for success or failure

---

## Step 6: Verify on the Pi

After a successful install, SSH back in to verify:

```bash
ssh sensthings@10.112.119.87

# Check hostname was set
hostname
# Expected: T3S-00001

# Check Docker container is running
sudo docker ps
# Expected: t3shield-firmware container running

# Check health
curl -s http://localhost:8080/health 2>/dev/null || echo "Health endpoint not available"

exit
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot reach device" | Check Ethernet/network, verify IP in Settings |
| "Authentication failed" | Check SSH username/password in Settings |
| Test Connection fails | Make sure the Pi is powered on and reachable: `ping 10.112.119.87` |
| Install fails at "Pull firmware image" | Check GHCR credentials — need `read:packages` scope |
| Install fails at "Login to registry" | Verify GHCR username and token are correct |
| Connection lost mid-install | Check Ethernet cable, retry |
| App won't start | Run `npm install` first, then `npm run dev` |

---

## Important: install.sh

The app currently has a **placeholder** `install.sh` in `src/assets/install.sh`.
Before testing, you need to replace it with the real script from the firmware repo:

```bash
# Option A: Copy from firmware repo
cp ~/t3-shield/t3-shield-firmware/scripts/install.sh \
   ~/t3-shield/t3-shield-firmware-installer-app/src/assets/install.sh

# Option B: Download from GitHub
curl -o src/assets/install.sh \
  https://raw.githubusercontent.com/SensThings/t3-shield-firmware/main/scripts/install.sh
```

Without the real `install.sh`, the install will immediately fail.
