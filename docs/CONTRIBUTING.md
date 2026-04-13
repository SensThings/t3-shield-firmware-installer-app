# T3-Shield Firmware Installer — Developer Guide

How to set up a development environment, understand the codebase, and make changes.

---

## Prerequisites

- **Node.js 20+** and npm (for frontend)
- **Python 3.12+** and pip (for backend)
- **Docker** (for building images, pulling firmware, running frontend container)
- **Git** + GitHub CLI (`gh`)

---

## Development Setup

### 1. Clone the repo

```bash
git clone https://github.com/SensThings/t3-shield-firmware-installer-app.git
cd t3-shield-firmware-installer-app
```

### 2. Frontend

```bash
npm install
npm run dev
# → http://localhost:3000
```

The frontend expects the backend at `http://localhost:8000`. Override with:

```bash
NEXT_PUBLIC_API_URL=http://other-host:8000 npm run dev
```

### 3. Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# → http://localhost:8000
```

The backend needs:
- Network access to a Raspberry Pi (default `192.168.137.100` via Ethernet)
- Docker daemon running (for `docker pull`, `docker save`, `docker manifest`)
- USB access to B210 SDR (only for SDR test, not for install)

### 4. Verify

- Backend health: `curl http://localhost:8000/health` → `{"status": "ok"}`
- Frontend: open `http://localhost:3000` → login with `op` / `123`

---

## Project Structure

```
t3-shield-firmware-installer-app/
├── backend/                    # FastAPI backend (Python)
│   ├── app/
│   │   ├── main.py             # App factory, CORS, router registration
│   │   ├── models/schemas.py   # Pydantic request/response models
│   │   ├── routers/            # HTTP endpoints
│   │   │   ├── install.py      # POST /install, GET /install/{id}/progress
│   │   │   ├── sdr_test.py     # POST /sdr-test, GET /sdr-test/{id}/progress
│   │   │   ├── settings.py     # Test SSH, test GHCR, checklist, login
│   │   │   └── cache.py        # GET/DELETE /cache
│   │   ├── services/           # Business logic
│   │   │   ├── installer.py    # Install orchestration (3 phases)
│   │   │   ├── sdr_tester.py   # SDR test orchestration
│   │   │   ├── ssh_service.py  # Paramiko SSH wrapper
│   │   │   └── offline_assets.py # Docker + firmware cache
│   │   ├── utils/
│   │   │   ├── progress_parser.py   # Parse install.sh output → events
│   │   │   ├── error_handler.py     # French error message loader
│   │   │   ├── error_messages.json  # All operator-facing messages
│   │   │   └── checklist.json       # Pre-flight checklist items
│   │   └── assets/             # Scripts uploaded to Pi
│   │       ├── install.sh      # 13-step firmware install script
│   │       └── sdr/            # SDR test scripts (config, rx, tx, test.sh)
│   ├── requirements.txt
│   └── Dockerfile
├── src/                        # Next.js frontend (TypeScript)
│   ├── app/
│   │   ├── layout.tsx          # Root layout (dark theme, French)
│   │   ├── page.tsx            # Main page (auth, session, settings)
│   │   └── login/page.tsx      # Login form
│   ├── components/
│   │   ├── SessionManager.tsx      # Checklist → program → next device
│   │   ├── PreflightChecklist.tsx  # Oui/Non checklist from backend
│   │   ├── DeviceProgrammer.tsx    # Install/SDR test + SSE subscription
│   │   ├── ProgressChecklist.tsx   # Step rows with live timers
│   │   ├── Header.tsx              # Operator, timer, device count
│   │   └── SettingsPanel.tsx       # SSH + GHCR config modal
│   └── lib/
│       ├── api.ts              # All backend API calls
│       ├── auth.ts             # localStorage auth
│       ├── settings.ts         # localStorage settings
│       └── types.ts            # Types + unified step lists (French)
├── deploy/                     # Desktop deployment scripts
│   ├── t3s-install.sh          # First-time desktop setup
│   └── t3s-update.sh           # Update backend + frontend
├── docs/                       # Documentation
├── docker-compose.yml          # Dev/demo: backend + frontend
├── Dockerfile                  # Frontend Docker image
├── .github/workflows/build.yml # CI: build + push both images
├── CLAUDE.md                   # AI assistant context
└── package.json
```

---

## How Things Connect

```
Browser → api.ts → FastAPI routers → services → SSH → Pi
                         ↓
                    SSE stream → DeviceProgrammer.tsx → ProgressChecklist.tsx
```

1. User clicks "Démarrer" → `api.ts:startInstall()` calls `POST /install`
2. Backend spawns a daemon thread → `installer.py:run_install()`
3. Install prepares assets, uploads via SSH, runs `install.sh`
4. `install.sh` prints progress to stderr → `progress_parser.py` parses it
5. Parsed events emitted via callback → stored in `active_installs` dict
6. Frontend polls `GET /install/{id}/progress` (SSE) → `DeviceProgrammer.tsx` updates step state
7. `ProgressChecklist.tsx` renders each step with status icon + timer

---

## Common Development Tasks

### Add a new install step

1. **Backend:** Add the step in `backend/app/assets/install.sh` (follow the existing pattern with `run_step`)
2. **Backend:** Add a French error message in `backend/app/utils/error_messages.json` under `install.{step_id}.fail`
3. **Frontend:** Add the step to `INSTALL_STEPS` in `src/lib/types.ts` with a French label and `source: 'install'`
4. The step number mapping is automatic — `backendNumber` is computed from position among `source: 'install'` steps

### Add a new API endpoint

1. Create or modify a router in `backend/app/routers/`
2. Add Pydantic models in `backend/app/models/schemas.py` if needed
3. Register the router in `backend/app/main.py` (if new file)
4. Add the fetch function in `src/lib/api.ts`
5. Call it from the appropriate component

### Add a new pre-flight checklist item

1. Edit `backend/app/utils/checklist.json` — add `{id, label}` (French label)
2. No frontend changes needed — `PreflightChecklist.tsx` renders dynamically from the API response

### Change error messages

1. Edit `backend/app/utils/error_messages.json`
2. Messages are loaded at runtime — no rebuild needed for backend
3. The frontend displays `operator_message` from SSE events, falling back to a generic French message

### Change SDR/antenna test parameters

Parameters are in JSON config files, editable via Settings UI or API:

- Default configs: `backend/app/assets/sdr/sdr_test_config.json` and `antenna_test_config.json`
- User overrides: saved to `~/.t3s-installer/` (take precedence over defaults)
- API: `GET/PUT /config/sdr-test` and `GET/PUT /config/antenna-test`
- `config.py` reads from JSON at runtime via `--config` flag (no more hardcoded values)

Key parameters: `snr_threshold_db`, `freq_tolerance_hz`, `search_bandwidth_hz`, `tx_gain`, `rx_gain`

---

## Git Workflow

### Jira

- Project key: **T3SFIA**
- Every change needs a Jira ticket

### Full workflow: making a change and deploying it

Here's the complete step-by-step from code change to running on desktops:

```bash
# 1. Make your changes
#    Edit files in src/, backend/, deploy/, docs/

# 2. Verify frontend builds
npm run build

# 3. Bump version (MANDATORY on every push)
#    Patch (x.x.X) for fixes, Minor (x.X.0) for features, Major (X.0.0) for breaking
echo "1.0.4" > VERSION
#    Also update package.json version to match:
#    "version": "1.0.4"

# 4. Stage your changes
git add -A

# 5. Commit with Jira ticket reference
git commit -m "T3SFIA-XX: description of what changed"

# 6. Tag the version
git tag v1.0.4

# 7. Push code + tag together
git push origin main --tags

# 8. Wait for CI to build (~2 min)
#    Check: https://github.com/SensThings/t3-shield-firmware-installer-app/actions
#    Or: gh run list --limit 2

# 9. Update desktops (SSH into each, or have technician double-click the update shortcut)
ssh user@desktop-ip "sudo bash /opt/t3s-installer/t3s-update.sh"

# 10. Verify
ssh user@desktop-ip "curl -s http://localhost:8000/health"
#    Should show: {"status":"ok","version":"1.0.4"}
```

### Branching convention

For feature branches (optional — small fixes can go directly to main):

```bash
git checkout -b T3SFIA-42/add-battery-check-step
# ... make changes ...
git push origin T3SFIA-42/add-battery-check-step
# Create PR on GitHub, squash merge to main
```

### Commit message format

```
T3SFIA-{ticket}: {imperative description}
```

Examples:
- `T3SFIA-42: add battery level check to install steps`
- `T3SFIA-43: fix SDR test timeout on slow Pi models`
- `T3SFIA-44: update checklist items`

### Pull Requests (for feature branches)

- Title: `T3SFIA-{ticket}: {description}`
- Must reference the Jira ticket
- Requires at least 1 approval
- All CI checks must pass
- Squash merge to `main`

---

## CI/CD

On push to `main` or version tag (`v*`):

1. **build-backend** — builds `backend/Dockerfile` → pushes `ghcr.io/sensthings/t3s-installer-backend:{latest,version,sha}`
2. **build-frontend** — builds root `Dockerfile` → pushes `ghcr.io/sensthings/t3s-installer-frontend:{latest,version,sha}`

Both jobs run in parallel (~2 min). See `.github/workflows/build.yml`.

Check CI status:

```bash
# From CLI
gh run list --repo SensThings/t3-shield-firmware-installer-app --limit 3

# Or watch a specific run
gh run watch <run-id> --repo SensThings/t3-shield-firmware-installer-app
```

If CI fails, check the logs:

```bash
gh run view <run-id> --repo SensThings/t3-shield-firmware-installer-app --log-failed
```

---

## Versioning

The app uses a single `VERSION` file in the repo root as the source of truth.

| Where | How it's used |
|-------|---------------|
| `VERSION` | Single source of truth (e.g. `1.0.0`) |
| `package.json` | Must match `VERSION` |
| Frontend | Read at build time via `next.config.ts` → displayed in Header |
| Backend | Read at startup in `app/main.py` → exposed in `GET /health` |
| Update script | Compares local vs remote version, shows before/after |

**Every push to main MUST bump the version.** The update script compares versions — same version = no update detected.

### Releasing a new version

```bash
# 1. Bump version
echo "1.1.0" > VERSION
# 2. Update package.json to match
#    "version": "1.1.0"

# 3. Commit
git add VERSION package.json
git commit -m "T3SFIA-XX: bump version to 1.1.0"

# 4. Tag
git tag v1.1.0

# 5. Push everything
git push origin main --tags

# 6. Wait for CI (check with: gh run list --limit 2)

# 7. Update desktops
ssh user@desktop-ip "sudo bash /opt/t3s-installer/t3s-update.sh"
```

### Update script options

```bash
bash t3s-update.sh              # Update if new version available
bash t3s-update.sh --check      # Show current vs latest, don't update
bash t3s-update.sh --force      # Update even if already on latest
bash t3s-update.sh v1.2.0       # Update to a specific version
```

### Updating all desktops at once

```bash
for host in 10.87.126.249 10.87.126.250 10.87.126.251; do
  echo "Updating $host..."
  ssh user@$host "sudo bash /opt/t3s-installer/t3s-update.sh" &
done
wait
echo "All desktops updated."
```

### To update desktops after a push

SSH into the desktop and run:

```bash
bash /opt/t3s-installer/t3s-update.sh
```

Or remotely:

```bash
ssh st2@10.87.126.249 "bash /opt/t3s-installer/t3s-update.sh"
```

---

## Build Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start frontend dev server (port 3000) |
| `npm run build` | Production build (check for errors) |
| `npm run lint` | ESLint check |
| `python -m uvicorn app.main:app --reload` | Start backend dev server (port 8000) |
| `docker compose up` | Run both services via Docker |
| `docker compose build` | Build both images locally |

---

## Key Design Decisions

1. **Decoupled architecture** — FastAPI backend + Next.js frontend. The v1 was a Next.js monolith using `ssh2` (Node.js SSH), which couldn't handle USB SDR access or native Python SDR scripts. Splitting allows the backend to run natively on the desktop with direct USB and Docker access.

2. **SSE over WebSocket** — Server-Sent Events are simpler for one-way streaming (server → client). Auto-reconnect is built into the browser. No socket.io dependency needed.

3. **Daemon threads over async** — Paramiko (SSH) and subprocess calls are blocking. Running them in daemon threads keeps the FastAPI event loop responsive without complex async wrappers.

4. **Offline-first** — Pi devices have no internet. Docker binaries and firmware images are cached on the desktop and transferred via SFTP. The install script detects offline mode automatically.

5. **French UI, English code** — All user-facing text is French (target users are Moroccan technicians). Code, comments, variable names, and git messages stay in English.

6. **Unified step list** — The frontend shows prep steps (desktop-side) and install steps (Pi-side) as one continuous numbered list. The `source` field (`'prep'` or `'install'`) determines which SSE event type updates each step.
