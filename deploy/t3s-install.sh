#!/bin/bash
# =============================================================================
# T3-Shield Installer — Desktop Setup Script
# =============================================================================
# Backend runs natively on host (needs UHD/Python)
# Frontend runs in Docker
# =============================================================================
GHCR_USER="elmoadin"
GHCR_TOKEN="${GHCR_TOKEN:-REPLACE_WITH_YOUR_GHCR_TOKEN}"
REGISTRY="ghcr.io"
INSTALL_DIR="/opt/t3s-installer"
BACKEND_REPO="https://github.com/SensThings/t3-shield-firmware-installer-app.git"
FRONTEND_IMAGE="${REGISTRY}/sensthings/t3s-installer-frontend:latest"

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
    echo "[1/8] Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo ""
    echo "Docker installed. Please LOG OUT and LOG BACK IN, then run this script again."
    read -p "Press Enter to exit..."
    exit 0
else
    echo "[1/8] Docker already installed"
fi

# --- Install Python deps for backend ---
echo "[2/8] Installing backend dependencies..."
sudo apt-get install -y -qq python3-pip python3-paramiko 2>/dev/null || true
sudo pip3 install --quiet --break-system-packages fastapi uvicorn pydantic httpx python-multipart 2>/dev/null || \
sudo pip3 install --quiet fastapi uvicorn pydantic httpx python-multipart 2>/dev/null || \
pip3 install --quiet --break-system-packages fastapi uvicorn pydantic httpx python-multipart 2>/dev/null || true

# --- Clone/update backend ---
echo "[3/8] Setting up backend..."
sudo mkdir -p "$INSTALL_DIR"
sudo chown "$USER":"$USER" "$INSTALL_DIR"

rm -rf "$INSTALL_DIR/repo" "$INSTALL_DIR/backend.old"
git clone --quiet --depth 1 "$BACKEND_REPO" "$INSTALL_DIR/repo" 2>/dev/null
if [ -d "$INSTALL_DIR/backend" ]; then
    mv "$INSTALL_DIR/backend" "$INSTALL_DIR/backend.old"
fi
mv "$INSTALL_DIR/repo/backend" "$INSTALL_DIR/backend"
cp "$INSTALL_DIR/repo/VERSION" "$INSTALL_DIR/VERSION" 2>/dev/null || true
cp "$INSTALL_DIR/repo/deploy/t3s-update.sh" "$INSTALL_DIR/t3s-update.sh" 2>/dev/null || true
rm -rf "$INSTALL_DIR/repo" "$INSTALL_DIR/backend.old"

# Create systemd service for backend
sudo tee /etc/systemd/system/t3s-backend.service >/dev/null << SVCEOF
[Unit]
Description=T3-Shield Installer Backend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/t3s-installer/backend
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=/home/$USER/.local/lib/python3.12/site-packages:/usr/local/lib/python3.12/dist-packages

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable t3s-backend >/dev/null 2>&1
sudo systemctl restart t3s-backend

# --- Login to GHCR and pull frontend ---
echo "[4/8] Setting up frontend..."
echo "$GHCR_TOKEN" | docker login "$REGISTRY" -u "$GHCR_USER" --password-stdin 2>/dev/null

docker stop t3s-frontend 2>/dev/null || true
docker rm t3s-frontend 2>/dev/null || true

docker pull "$FRONTEND_IMAGE" 2>/dev/null
docker run -d \
    --name t3s-frontend \
    --network host \
    -e NEXT_PUBLIC_API_URL=http://localhost:8000 \
    -e PORT=3000 \
    -e HOSTNAME=0.0.0.0 \
    --restart unless-stopped \
    "$FRONTEND_IMAGE"

# --- Configure Ethernet for Pi access ---
echo "[5/8] Configuring Ethernet..."
ETH_IFACE=$(ip -o link show | grep -E 'eth|enp|ens' | head -1 | awk -F: '{print $2}' | tr -d ' ')
if [ -n "$ETH_IFACE" ]; then
    if ! nmcli con show "Pi-Ethernet" &>/dev/null 2>&1; then
        sudo nmcli con add type ethernet con-name "Pi-Ethernet" ifname "$ETH_IFACE" ip4 192.168.137.1/24 2>/dev/null || true
        echo "  Ethernet: $ETH_IFACE → 192.168.137.1/24"
    else
        echo "  Ethernet already configured"
    fi
fi

# --- USB permissions for SDR ---
echo "[6/8] Setting USB permissions for SDR..."
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2500", MODE="0666"' | sudo tee /etc/udev/rules.d/99-uhd-usrp.rules >/dev/null
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="3923", MODE="0666"' | sudo tee -a /etc/udev/rules.d/99-uhd-usrp.rules >/dev/null
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true

# --- Create desktop shortcuts ---
echo "[7/8] Creating desktop shortcuts..."
DESKTOP_DIR=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
mkdir -p "$DESKTOP_DIR"

# Update shortcut
cat > "$DESKTOP_DIR/T3S-Mise-a-jour.desktop" << DEOF
[Desktop Entry]
Name=T3-Shield Mise à jour
Comment=Mettre à jour l'installateur T3-Shield
Exec=bash -c 'sudo bash /opt/t3s-installer/t3s-update.sh; echo ""; read -p "Appuyez sur Entrée pour fermer..."'
Terminal=true
Type=Application
Icon=system-software-update
Categories=Utility;
DEOF
chmod +x "$DESKTOP_DIR/T3S-Mise-a-jour.desktop"

# Open installer shortcut
cat > "$DESKTOP_DIR/T3-Shield-Installateur.desktop" << DEOF
[Desktop Entry]
Name=T3-Shield Installateur
Comment=Ouvrir l'installateur T3-Shield
Exec=xdg-open http://localhost:3000
Terminal=false
Type=Application
Icon=applications-internet
Categories=Utility;
DEOF
chmod +x "$DESKTOP_DIR/T3-Shield-Installateur.desktop"

# Trust the shortcuts (GNOME)
gio set "$DESKTOP_DIR/T3S-Mise-a-jour.desktop" metadata::trusted true 2>/dev/null || true
gio set "$DESKTOP_DIR/T3-Shield-Installateur.desktop" metadata::trusted true 2>/dev/null || true

echo "  Shortcuts created on desktop"

# --- Verify ---
echo "[8/8] Verifying..."
sleep 3
echo ""
echo "========================================="
curl -sf http://localhost:8000/health >/dev/null 2>&1 && echo "  Backend:  OK" || echo "  Backend:  starting... (sudo systemctl status t3s-backend)"
curl -sf http://localhost:3000 >/dev/null 2>&1 && echo "  Frontend: OK" || echo "  Frontend: starting... (docker logs t3s-frontend)"
echo ""
echo "  Open http://localhost:3000"
echo "========================================="

xdg-open http://localhost:3000 2>/dev/null || true

echo ""
read -p "Appuyez sur Entrée pour fermer..." 2>/dev/null || true
