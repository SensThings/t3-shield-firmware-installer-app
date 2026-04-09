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

### Change SDR test parameters

1. Edit `backend/app/assets/sdr/config.py` (frequency, gain, thresholds)
2. Both `tx_tone.py` and `rx_tone.py` import from `config.py`

---

## Git Workflow

### Jira

- Project key: **T3SFIA**
- Every change needs a Jira ticket

### Branching

```
T3SFIA-{ticket}/{short-description}
```

Example: `T3SFIA-42/add-battery-check-step`

### Commits

```
T3SFIA-{ticket}: {imperative description}
```

Example: `T3SFIA-42: add battery level check to install steps`

### Pull Requests

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

Both jobs run in parallel. See `.github/workflows/build.yml`.

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
