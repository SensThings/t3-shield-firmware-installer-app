# T3-Shield Firmware Installer App

**Desktop web application for programming Raspberry Pi devices with T3-Shield firmware.** Decoupled architecture: FastAPI backend (Python, runs natively) + Next.js frontend (Docker container). Deployed on technician desktops. Used to set up 2,000 devices.

## Repos

- **This repo:** `https://github.com/SensThings/t3-shield-firmware-installer-app.git`
- **Firmware repo:** `https://github.com/SensThings/t3-shield-firmware.git`

## Jira

- **Project key:** T3SFIA

---

## Architecture

```
Browser (localhost:3000)         → Next.js frontend (UI only)
    ↕ HTTP + SSE
FastAPI backend (localhost:8000) → SSH/SFTP to Pi, SDR TX, firmware cache
    ↕ SSH over Ethernet
Raspberry Pi (192.168.137.100)   → install.sh, Docker, firmware, SDR RX
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React, Tailwind CSS |
| Backend | FastAPI, Python 3.12, Paramiko (SSH), UHD (SDR) |
| Communication | HTTP + Server-Sent Events (SSE) |
| Deployment | systemd (backend) + Docker (frontend) |
| CI/CD | GitHub Actions → `ghcr.io/sensthings/t3s-installer-{backend,frontend}` |

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Full technical reference
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — Developer guide + git workflow
- **[docs/SETUP.md](docs/SETUP.md)** — Desktop deployment + troubleshooting

---

## UI Design

- **Dark mode** — easier on eyes during long setup sessions
- **Desktop only** — no mobile responsiveness needed
- **All UI text in French** — code and git messages stay in English
- **Status colors:** green=pass, red=fail, yellow=in-progress, grey=pending

## Session Workflow

Login → Pre-flight checklist → Serial input → Program (18 steps) → SDR Test (6 steps) → Next device

---

## Git Convention

- Branch: `T3SFIA-{ticket}/{short-description}`
- Commit: `T3SFIA-{ticket}: {imperative description}`
- Tags: `vX.Y.Z`

## Automated Workflow

1. Verify MCPs (Jira + GitHub) → 2. Create Jira tickets → 3. Branch → 4. Implement → 5. Commit + push → 6. PR + merge → 7. Jira Done → 8. Version tag if needed → 9. Report

Do NOT ask permission — execute the full workflow. If MCP missing, STOP. Never skip Jira.
