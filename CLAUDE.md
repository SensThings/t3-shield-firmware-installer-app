# T3-Shield Firmware Installer App

**Desktop web application for programming new Raspberry Pi devices with T3-Shield firmware.** Technicians connect a fresh Pi via Ethernet, enter a serial number, click Start, and the app handles everything via SSH — hostname, Docker, image pull, container start, SDR verification.

Deployed as a Docker container on 10 technician desktops. Used to set up 2,000 devices.

## Repos

- **This repo:** `https://github.com/SensThings/t3-shield-firmware-installer-app.git`
- **Firmware repo:** `https://github.com/SensThings/t3-shield-firmware.git` (provides `scripts/install.sh`)

## Jira

- **Project key:** T3SFIA

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Technician Desktop                                       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Browser (localhost:3000)                            │  │
│  │  - "Program New Device" button                      │  │
│  │  - Serial number input                              │  │
│  │  - Real-time step-by-step progress                  │  │
│  │  - Settings (IP, credentials)                       │  │
│  └──────────────┬──────────────────────────────────────┘  │
│                 │ HTTP + WebSocket                         │
│  ┌──────────────▼──────────────────────────────────────┐  │
│  │  Next.js Backend (API routes + ssh2)                │  │
│  │  - SSH into Pi                                      │  │
│  │  - Stream install progress via WebSocket            │  │
│  │  - Parse JSON results                               │  │
│  └──────────────┬──────────────────────────────────────┘  │
│                 │ SSH over Ethernet                        │
└─────────────────┼─────────────────────────────────────────┘
                  │ RJ45 (192.168.137.100)
         ┌────────▼────────┐
         │  Raspberry Pi    │
         │  (fresh device)  │
         └─────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14+ (App Router), React, Tailwind CSS |
| Backend | Next.js API routes + WebSocket (socket.io) |
| SSH | `ssh2` npm package |
| Containerization | Docker (the installer app itself runs in Docker) |
| CI/CD | GitHub Actions → `ghcr.io/sensthings/t3-shield-firmware-installer-app` |

## How It Works

### Install Flow

1. Technician enters serial number (e.g., `12345`)
2. App SSHs into Pi at configured IP (default: `192.168.137.100`)
3. Uploads `install.sh` from firmware repo (bundled in the app)
4. Executes:
   ```bash
   sudo GHCR_USER=<user> GHCR_TOKEN=<token> bash /tmp/install.sh \
     --hostname T3S-12345 --json 2>&1
   ```
5. Streams progress (stderr lines) to browser via WebSocket
6. Parses final JSON result (stdout) for status
7. Shows pass/fail with step-by-step checklist

### Install Script Steps (11 total, from firmware repo)

| # | ID | Label |
|---|-----|-------|
| 1 | `set_hostname` | Set device hostname (T3S-<serial>) |
| 2 | `docker_install` | Install Docker |
| 3 | `create_dirs` | Create data directories |
| 4 | `write_config` | Write default config |
| 5 | `registry_login` | Login to registry |
| 6 | `pull_image` | Pull firmware image |
| 7 | `install_update_script` | Install update script |
| 8 | `start_container` | Start container |
| 9 | `health_check` | Health check |
| 10 | `sdr_warmup` | SDR warmup |
| 11 | `sdr_verify` | Verify SDR status |

### SSH Connection

- **Default IP (Ethernet):** `192.168.137.100`
- **Default user:** `sensthings`
- **Default password:** `Sensthings@012`
- **Configurable** via Settings panel (IP, user, password)
- Settings stored in browser localStorage

### Settings Panel

Accessed via gear icon. Contains:
- **Device IP** — default: `192.168.137.100` (Ethernet), changeable for WiFi
- **SSH Username** — default: `sensthings`
- **SSH Password** — default: `Sensthings@012`
- **GHCR Username** — for container registry login
- **GHCR Token** — GitHub PAT with `read:packages` scope
- **Firmware Image** — default: `ghcr.io/sensthings/t3shield-firmware:latest`
- **Test Connection** button — tries SSH and shows success/fail

---

## Docker (This App)

### Image

- **Registry:** `ghcr.io/sensthings/t3-shield-firmware-installer-app`
- **Base:** `node:20-slim`
- **Runs on:** Technician desktops (x86_64)

### Run

```bash
docker run -d \
  --name t3shield-installer \
  --network host \
  -p 3000:3000 \
  ghcr.io/sensthings/t3-shield-firmware-installer-app:latest
```

### CI/CD

On push to `main` or version tag (`v*`):
1. Build x86_64 image
2. Push to `ghcr.io/sensthings/t3-shield-firmware-installer-app:{latest,version,sha}`

---

## UI Design

- **Dark mode** — easier on eyes during long setup sessions
- **Desktop only** — no mobile responsiveness needed
- **Clean, professional** — internal tool for technicians
- **Status colors:** green=pass, red=fail, yellow=in-progress, grey=pending

---

## Automated Workflow — EVERY BATCH OF TICKETS

### MCP Check (BEFORE any work)

Verify Jira (T3SFIA) + GitHub MCP. If either fails: **STOP**, tell me.

### Workflow (MANDATORY order)

1. Verify MCPs → 2. Create Jira tickets → 3. Branch → 4. Implement → 5. Commit + push → 6. PR + merge → 7. Jira Done → 8. Version tag if needed → 9. Report

### Git Convention

- Branch: `T3SFIA-{ticket}/{short-description}`
- Commit: `T3SFIA-{ticket}: {imperative description}`
- Tags: `vX.Y.Z`
- Do NOT ask permission — execute the full workflow.
- If MCP missing, STOP. Never skip Jira.
