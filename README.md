# T3-Shield Firmware Installer App

Desktop web app for programming new Raspberry Pi devices with T3-Shield firmware. Technicians connect a fresh Pi via Ethernet, enter a serial number, click Start, and the app handles everything via SSH.

## Quick Start

### Docker (recommended)

```bash
docker run -d --name t3shield-installer --network host \
  ghcr.io/sensthings/t3-shield-firmware-installer-app:latest
```

Open http://localhost:3000

### Development

```bash
npm install
npm run dev
```

## Usage

1. Connect a Raspberry Pi via Ethernet (default IP: `192.168.137.100`)
2. Configure GHCR credentials in Settings (gear icon)
3. Click **Program New Device**
4. Enter the device serial number
5. Watch real-time progress as the firmware is installed

## Configuration

Access settings via the gear icon in the header:

| Setting | Default | Description |
|---------|---------|-------------|
| Device IP | `192.168.137.100` | Pi's Ethernet IP |
| SSH Username | `sensthings` | SSH login user |
| SSH Password | `Sensthings@012` | SSH login password |
| GHCR Username | *(required)* | GitHub username for container registry |
| GHCR Token | *(required)* | GitHub PAT with `read:packages` scope |
| Firmware Image | `ghcr.io/sensthings/t3shield-firmware:latest` | Docker image to pull |

## Install Steps

The firmware installation runs 11 steps on the Pi:

1. Set device hostname (T3S-\<serial\>)
2. Install Docker
3. Create data directories
4. Write default config
5. Login to container registry
6. Pull firmware image
7. Install update script
8. Start container
9. Health check
10. SDR warmup
11. Verify SDR status

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React, Tailwind CSS
- **Backend:** Next.js API routes with SSE streaming
- **SSH:** `ssh2` npm package
- **Container:** Docker with standalone Next.js output
