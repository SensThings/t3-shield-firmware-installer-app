#!/bin/bash
# =============================================================================
# T3-Shield Installer — Update Script
# =============================================================================
INSTALL_DIR="/opt/t3s-installer"
GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"
FRONTEND_IMAGE="ghcr.io/sensthings/t3s-installer-frontend:latest"
BACKEND_REPO="https://github.com/SensThings/t3-shield-firmware-installer-app.git"

echo "Updating T3-Shield Installer..."

# Update backend (re-clone since it's not a git repo)
echo "Updating backend..."
rm -rf "$INSTALL_DIR/repo" "$INSTALL_DIR/backend.old"
git clone --depth 1 --quiet "$BACKEND_REPO" "$INSTALL_DIR/repo" 2>&1
mv "$INSTALL_DIR/backend" "$INSTALL_DIR/backend.old" 2>/dev/null
mv "$INSTALL_DIR/repo/backend" "$INSTALL_DIR/backend"
rm -rf "$INSTALL_DIR/repo" "$INSTALL_DIR/backend.old"
sudo systemctl restart t3s-backend

# Update frontend (docker pull)
echo "Updating frontend..."
echo "$GHCR_TOKEN" | docker login ghcr.io -u elmoadin --password-stdin 2>/dev/null
docker pull "$FRONTEND_IMAGE" 2>/dev/null
docker stop t3s-frontend 2>/dev/null || true
docker rm t3s-frontend 2>/dev/null || true
docker run -d --name t3s-frontend --network host \
    -e NEXT_PUBLIC_API_URL=http://localhost:8000 \
    -e PORT=3000 -e HOSTNAME=0.0.0.0 \
    --restart unless-stopped "$FRONTEND_IMAGE"

echo "Update complete! Refresh your browser."
