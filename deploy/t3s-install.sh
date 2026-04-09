#!/bin/bash
# =============================================================================
# T3-Shield Installer — Desktop Setup Script
# =============================================================================
# Copy to desktop, chmod +x, double-click. Handles everything:
# - Docker install (if missing)
# - GHCR login
# - Pull + start containers
# - Ethernet config for Pi access
# - USB permissions for SDR
# =============================================================================
set -e

GHCR_USER="elmoadin"
GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"
REGISTRY="ghcr.io"
INSTALL_DIR="/opt/t3s-installer"

echo "========================================="
echo "  T3-Shield Installer — Desktop Setup"
echo "========================================="

# --- Fix apt sources for Dragon OS ---
sudo mkdir -p /etc/apt/apt.conf.d /etc/apt/sources.list.d /etc/apt/preferences.d /etc/udev/rules.d
if [ ! -f /etc/apt/sources.list ] || ! grep -q "ubuntu" /etc/apt/sources.list 2>/dev/null; then
    echo "Fixing apt sources..."
    echo "deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse" | sudo tee /etc/apt/sources.list >/dev/null
    echo "deb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse" | sudo tee -a /etc/apt/sources.list >/dev/null
    echo "deb http://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse" | sudo tee -a /etc/apt/sources.list >/dev/null
    sudo apt-get update -qq 2>/dev/null
fi

# --- Install Docker ---
if ! command -v docker &>/dev/null; then
    echo "[1/6] Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo ""
    echo "Docker installed. Please LOG OUT and LOG BACK IN, then run this script again."
    echo ""
    read -p "Press Enter to exit..."
    exit 0
else
    echo "[1/6] Docker already installed"
fi

# --- Install Docker Compose ---
if ! docker compose version &>/dev/null 2>&1; then
    echo "[2/6] Installing Docker Compose..."
    sudo apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
else
    echo "[2/6] Docker Compose ready"
fi

# --- Login to GHCR ---
echo "[3/6] Logging in to container registry..."
echo "$GHCR_TOKEN" | docker login "$REGISTRY" -u "$GHCR_USER" --password-stdin 2>/dev/null

# --- Configure Ethernet for Pi access ---
echo "[4/6] Configuring Ethernet..."
ETH_IFACE=$(ip -o link show | grep -E 'eth|enp|ens' | head -1 | awk -F: '{print $2}' | tr -d ' ')
if [ -n "$ETH_IFACE" ]; then
    if ! nmcli con show "Pi-Ethernet" &>/dev/null 2>&1; then
        sudo nmcli con add type ethernet con-name "Pi-Ethernet" ifname "$ETH_IFACE" ip4 192.168.137.1/24 2>/dev/null || true
        echo "  Ethernet configured: $ETH_IFACE → 192.168.137.1/24"
    else
        echo "  Ethernet already configured"
    fi
else
    echo "  No Ethernet interface found — configure manually"
fi

# --- USB permissions for SDR ---
echo "[5/6] Setting USB permissions for SDR..."
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2500", MODE="0666"' | sudo tee /etc/udev/rules.d/99-uhd-usrp.rules >/dev/null
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="3923", MODE="0666"' | sudo tee -a /etc/udev/rules.d/99-uhd-usrp.rules >/dev/null
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true

# --- Pull and start containers ---
echo "[6/6] Pulling and starting containers..."
sudo mkdir -p "$INSTALL_DIR"
sudo chown "$USER":"$USER" "$INSTALL_DIR"

cat > "$INSTALL_DIR/docker-compose.yml" << 'COMPOSEOF'
services:
  backend:
    image: ghcr.io/sensthings/t3s-installer-backend:latest
    network_mode: host
    privileged: true
    volumes:
      - /dev/bus/usb:/dev/bus/usb
      - /var/run/docker.sock:/var/run/docker.sock
      - firmware-cache:/root/.t3shield-installer
    restart: unless-stopped
    environment:
      - PYTHONUNBUFFERED=1

  frontend:
    image: ghcr.io/sensthings/t3s-installer-frontend:latest
    network_mode: host
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
      - PORT=3000
      - HOSTNAME=0.0.0.0
    restart: unless-stopped
    depends_on:
      - backend

volumes:
  firmware-cache:
COMPOSEOF

cd "$INSTALL_DIR"
docker compose pull
docker compose up -d

echo ""
echo "========================================="
echo "  Setup complete!"
echo "  Open http://localhost:3000 in browser"
echo "========================================="
echo ""

# Open browser
xdg-open http://localhost:3000 2>/dev/null || true
