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
- **[docs/DEBUGGING.md](docs/DEBUGGING.md)** — Systematic debugging guide (layer-by-layer)

---

## UI Design

- **Dark mode** — easier on eyes during long setup sessions
- **Desktop only** — no mobile responsiveness needed
- **All UI text in French** — code and git messages stay in English
- **Status colors:** green=pass, red=fail, yellow=in-progress, grey=pending
- **No technical values in UI** — no SNR, freq, dB shown to technicians. Only custom French messages.
- **Config issues** shown in amber (not red) with "Paramètres" button

## Session Workflow

Login → Pre-flight checklist → Serial input → Program (18 steps) → SDR Test (6 steps) → Next device

Antenna test desktop has a separate flow: Login → Antenna Test (5 steps) → Next antenna

## Data Directory

All app data under `~/.t3s-installer/`: `cache/` (firmware, Docker binaries), `logs/` (operation logs per device), JSON configs (SDR/antenna test params).

Operation logs are written for every operation (pass or fail) and never deleted — used for remote diagnosis.

---

## Versioning

- **Single source of truth:** `VERSION` file in repo root (e.g. `1.0.0`)
- `package.json` version must match `VERSION`
- Backend reads `VERSION` at startup → exposed in `GET /health` response
- Frontend reads `VERSION` at build time → displayed in Header
- Update script supports: `--check` (compare versions), `--force`, or `vX.Y.Z` (specific version)

**MANDATORY: Bump the version on every push to main.** Use semver:
- **Patch** (1.0.X): bug fixes, UI tweaks, doc updates
- **Minor** (1.X.0): new features, new steps, new endpoints
- **Major** (X.0.0): breaking changes, architecture changes

**How to release:** Update `VERSION` + `package.json` version → commit → `git tag vX.Y.Z` → `git push origin main --tags`

**Do NOT push to main without bumping the version.** The update script compares versions — same version = no update detected.

## Rules: Documentation

**After every change that modifies behavior, architecture, APIs, steps, workflows, or configuration:**

1. Update the relevant doc(s) in `docs/` to reflect the change:
   - `docs/ARCHITECTURE.md` — if components, endpoints, steps, flows, or protocols changed
   - `docs/CONTRIBUTING.md` — if project structure, dev setup, or git workflow changed
   - `docs/SETUP.md` — if deployment, configuration, or troubleshooting changed
   - `docs/DEBUGGING.md` — if new error paths, log locations, or diagnostic commands changed
2. Update `README.md` if the overview, tech stack, or quick start changed
3. Update this `CLAUDE.md` if architecture, workflow, or conventions changed

**Do NOT wait to be asked.** Documentation updates are part of the implementation, not a follow-up task. If you add a step, endpoint, component, or config — the docs get updated in the same commit or PR.

## Git Convention

- Branch: `T3SFIA-{ticket}/{short-description}`
- Commit: `T3SFIA-{ticket}: {imperative description}`
- Tags: `vX.Y.Z`

## Automated Workflow

1. Verify MCPs (Jira + GitHub) → 2. Create Jira tickets → 3. Branch → 4. Implement → 5. Commit + push → 6. PR + merge → 7. Jira Done → 8. Version tag if needed → 9. Report

Do NOT ask permission — execute the full workflow. If MCP missing, STOP. Never skip Jira.
