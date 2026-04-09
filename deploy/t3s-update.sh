#!/bin/bash
# =============================================================================
# T3-Shield Installer — Update Script
# =============================================================================
# Pulls latest images and restarts containers.
# =============================================================================
INSTALL_DIR="/opt/t3s-installer"
GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"

echo "Updating T3-Shield Installer..."
echo "$GHCR_TOKEN" | docker login ghcr.io -u elmoadin --password-stdin 2>/dev/null
cd "$INSTALL_DIR"
docker compose pull
docker compose up -d --remove-orphans
echo "Update complete! Refresh your browser."
