#!/bin/bash
# =============================================================================
# T3-Shield Installer — Update Script
# =============================================================================
INSTALL_DIR="/opt/t3s-installer"
GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"
FRONTEND_IMAGE="ghcr.io/sensthings/t3s-installer-frontend:latest"

echo "Updating T3-Shield Installer..."

# Update backend (git pull)
echo "Updating backend..."
cd "$INSTALL_DIR/backend" && git pull --quiet 2>/dev/null || true
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
