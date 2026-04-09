# T3-Shield Firmware Installer

Desktop web application for programming new Raspberry Pi devices with T3-Shield firmware. Technicians connect a fresh Pi via Ethernet, enter a serial number, click Start, and the app handles everything — file transfers, Docker installation, firmware deployment, and SDR verification.

Deployed on technician desktops as a two-service stack: FastAPI backend (native) + Next.js frontend (Docker).

## Architecture

```
Browser (localhost:3000)        → Next.js frontend (UI, SSE client)
    ↕ HTTP + SSE
FastAPI backend (localhost:8000) → SSH/SFTP to Pi, SDR TX, cache
    ↕ SSH over Ethernet
Raspberry Pi (192.168.137.100)  → install.sh, firmware container, SDR RX
```

## Quick Start (Development)

```bash
# Frontend
npm install && npm run dev          # → http://localhost:3000

# Backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Login: `op` / `123`

## Desktop Deployment

```bash
sudo bash deploy/t3s-install.sh          # First-time setup
bash /opt/t3s-installer/t3s-update.sh --check  # Check for updates
sudo bash /opt/t3s-installer/t3s-update.sh     # Update to latest
```

Version displayed in browser header and `GET /health`. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md#versioning) for release workflow.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full technical reference — components, protocols, data flows, step-by-step install/SDR flows |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Developer guide — project structure, how to add steps/endpoints, git workflow, CI/CD |
| [docs/SETUP.md](docs/SETUP.md) | Desktop deployment — prerequisites, installation, configuration, troubleshooting |
| [docs/DEBUGGING.md](docs/DEBUGGING.md) | Systematic debugging guide — layer-by-layer diagnosis, logs, manual testing |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React, Tailwind CSS |
| Backend | FastAPI, Python 3.12, Paramiko (SSH), UHD (SDR) |
| Communication | HTTP + Server-Sent Events (SSE) |
| Deployment | systemd (backend) + Docker (frontend) |
| CI/CD | GitHub Actions → `ghcr.io/sensthings/t3s-installer-{backend,frontend}` |

## Repos

- **This repo:** Installer app (frontend + backend + deploy scripts)
- **Firmware:** [SensThings/t3-shield-firmware](https://github.com/SensThings/t3-shield-firmware) (provides `install.sh` and the firmware Docker image)
