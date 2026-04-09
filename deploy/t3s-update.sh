#!/bin/bash
# =============================================================================
# T3-Shield Installer — Update Script
# Usage: bash t3s-update.sh [--check | --force | vX.Y.Z]
#   --check   Show current vs latest version, don't update
#   --force   Update even if already on latest
#   vX.Y.Z    Update to a specific version tag
# =============================================================================
INSTALL_DIR="/opt/t3s-installer"
GHCR_TOKEN="REPLACE_WITH_YOUR_GHCR_TOKEN"
FRONTEND_IMAGE="ghcr.io/sensthings/t3s-installer-frontend"
BACKEND_REPO="https://github.com/SensThings/t3-shield-firmware-installer-app.git"

# Current version
CURRENT="unknown"
if [ -f "$INSTALL_DIR/backend/VERSION" ]; then
    CURRENT=$(cat "$INSTALL_DIR/backend/VERSION" | tr -d '[:space:]')
elif [ -f "$INSTALL_DIR/VERSION" ]; then
    CURRENT=$(cat "$INSTALL_DIR/VERSION" | tr -d '[:space:]')
fi

# Latest version from GitHub
LATEST=$(git ls-remote --tags "$BACKEND_REPO" 2>/dev/null | grep -oP 'refs/tags/v\K[0-9.]+$' | sort -V | tail -1)
LATEST=${LATEST:-"unknown"}

echo "Current version: v$CURRENT"
echo "Latest version:  v$LATEST"

# Handle --check flag
if [ "$1" = "--check" ]; then
    if [ "$CURRENT" = "$LATEST" ]; then
        echo "Already up to date."
    else
        echo "Update available. Run: bash t3s-update.sh"
    fi
    exit 0
fi

# Handle specific version or default to latest
TARGET_TAG=""
if [[ "$1" =~ ^v[0-9] ]]; then
    TARGET_TAG="$1"
    echo "Updating to specific version: $TARGET_TAG"
elif [ "$CURRENT" = "$LATEST" ] && [ "$1" != "--force" ]; then
    echo "Already up to date. Use --force to update anyway."
    exit 0
fi

echo ""
echo "Updating T3-Shield Installer..."

# Update backend (re-clone)
echo "Updating backend..."
CLONE_ARGS="--depth 1 --quiet"
if [ -n "$TARGET_TAG" ]; then
    CLONE_ARGS="--depth 1 --quiet --branch $TARGET_TAG"
fi
rm -rf "$INSTALL_DIR/repo" "$INSTALL_DIR/backend.old"
git clone $CLONE_ARGS "$BACKEND_REPO" "$INSTALL_DIR/repo" 2>&1
mv "$INSTALL_DIR/backend" "$INSTALL_DIR/backend.old" 2>/dev/null
mv "$INSTALL_DIR/repo/backend" "$INSTALL_DIR/backend"
# Keep VERSION and update script in install dir
cp "$INSTALL_DIR/repo/VERSION" "$INSTALL_DIR/VERSION" 2>/dev/null
cp "$INSTALL_DIR/repo/deploy/t3s-update.sh" "$INSTALL_DIR/t3s-update.sh.new" 2>/dev/null
rm -rf "$INSTALL_DIR/repo" "$INSTALL_DIR/backend.old"
# Self-update: replace this script with the new version (preserving GHCR_TOKEN)
if [ -f "$INSTALL_DIR/t3s-update.sh.new" ]; then
    OLD_TOKEN=$(grep '^GHCR_TOKEN=' "$INSTALL_DIR/t3s-update.sh" | cut -d'"' -f2)
    if [ -n "$OLD_TOKEN" ] && [ "$OLD_TOKEN" != "REPLACE_WITH_YOUR_GHCR_TOKEN" ]; then
        sed -i "s|GHCR_TOKEN=\"REPLACE_WITH_YOUR_GHCR_TOKEN\"|GHCR_TOKEN=\"$OLD_TOKEN\"|" "$INSTALL_DIR/t3s-update.sh.new"
    fi
    mv "$INSTALL_DIR/t3s-update.sh.new" "$INSTALL_DIR/t3s-update.sh"
fi
sudo systemctl restart t3s-backend

# Update frontend (docker pull)
echo "Updating frontend..."
echo "$GHCR_TOKEN" | docker login ghcr.io -u elmoadin --password-stdin 2>/dev/null
PULL_TAG="latest"
if [ -n "$TARGET_TAG" ]; then
    PULL_TAG="$TARGET_TAG"
fi
docker pull "$FRONTEND_IMAGE:$PULL_TAG" 2>/dev/null
docker stop t3s-frontend 2>/dev/null || true
docker rm t3s-frontend 2>/dev/null || true
docker run -d --name t3s-frontend --network host \
    -e NEXT_PUBLIC_API_URL=http://localhost:8000 \
    -e PORT=3000 -e HOSTNAME=0.0.0.0 \
    --restart unless-stopped "$FRONTEND_IMAGE:$PULL_TAG"

# Show new version
NEW_VERSION="unknown"
if [ -f "$INSTALL_DIR/VERSION" ]; then
    NEW_VERSION=$(cat "$INSTALL_DIR/VERSION" | tr -d '[:space:]')
fi
echo ""
echo "Update complete! v$CURRENT → v$NEW_VERSION"
echo "Refresh your browser."
