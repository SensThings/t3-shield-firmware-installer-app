# T3-Shield Firmware Installer — Architecture

Complete technical reference for the firmware installer application.

---

## Overview

The T3-Shield Firmware Installer programs fresh Raspberry Pi devices with T3-Shield firmware. A technician connects a Pi via Ethernet, enters a serial number, and the app handles everything: file transfers, Docker installation, firmware deployment, and SDR verification — all over SSH.

The system is designed for **offline operation**. The Pi has no internet — all binaries and images are cached on the desktop and transferred via SFTP.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│  Technician Desktop                                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Browser (localhost:3000)                           │  │
│  │  Next.js frontend                                   │  │
│  │  - Login → Checklist → Serial → Program → Test     │  │
│  │  - Real-time step progress (SSE)                    │  │
│  │  - Settings (SSH, GHCR, firmware image)             │  │
│  └─────────────┬──────────────────────────────────────┘  │
│                │ HTTP + SSE                               │
│  ┌─────────────▼──────────────────────────────────────┐  │
│  │  FastAPI backend (localhost:8000)                   │  │
│  │  - Manages SSH sessions to Pi                       │  │
│  │  - Caches Docker binaries + firmware image          │  │
│  │  - Runs SDR TX (transmitter) for tests              │  │
│  │  - Streams progress events to frontend              │  │
│  └─────────────┬──────────────────────────────────────┘  │
│                │                                          │
│  B210 SDR ─────┘ (USB, for SDR test TX)                  │
└────────────────┼──────────────────────────────────────────┘
                 │ SSH over Ethernet (192.168.137.100)
        ┌────────▼────────┐
        │  Raspberry Pi    │
        │  (fresh device)  │
        │  B210 SDR (USB)  │
        └─────────────────┘
```

---

## Components

### Frontend (Next.js 16, React)

A client-side web app — all components are `'use client'`. No server-side rendering, no API routes. The backend is a separate FastAPI process.

| File | Purpose |
|------|---------|
| `src/app/layout.tsx` | Root layout, dark theme, French locale |
| `src/app/page.tsx` | Main page — auth check, session state, settings |
| `src/app/login/page.tsx` | Login form (French), calls `POST /auth/login` |
| `src/components/SessionManager.tsx` | Orchestrates: checklist → program → next device |
| `src/components/PreflightChecklist.tsx` | Loads items from `GET /checklist`, Oui/Non buttons |
| `src/components/DeviceProgrammer.tsx` | Install/SDR test logic, SSE subscription, step state |
| `src/components/ProgressChecklist.tsx` | Step-by-step checklist with per-step timers |
| `src/components/Header.tsx` | Operator name, session timer, device count, connection status |
| `src/components/SettingsPanel.tsx` | SSH + GHCR settings modal, test buttons |
| `src/lib/api.ts` | All fetch calls to backend (install, sdr-test, settings, cache, auth, checklist) |
| `src/lib/auth.ts` | localStorage auth persistence (login/logout) |
| `src/lib/settings.ts` | localStorage settings persistence |
| `src/lib/types.ts` | TypeScript types, unified step lists (French labels) |

### Backend (FastAPI, Python 3.12)

Runs natively on the desktop (systemd service, not Docker in production).

| File | Purpose |
|------|---------|
| `app/main.py` | FastAPI app, CORS, router registration, `/health` |
| `app/models/schemas.py` | Pydantic models for all request/response payloads |
| `app/routers/install.py` | `POST /install`, `GET /install/{id}/progress` (SSE) |
| `app/routers/sdr_test.py` | `POST /sdr-test`, `GET /sdr-test/{id}/progress` (SSE) |
| `app/routers/settings.py` | `POST /settings/test`, `POST /settings/test-ghcr`, `GET /checklist`, `POST /auth/login` |
| `app/routers/cache.py` | `GET /cache`, `DELETE /cache` |
| `app/services/installer.py` | Install orchestration: prepare assets → upload → run install.sh |
| `app/services/sdr_tester.py` | SDR test orchestration: check SDR → upload scripts → TX → RX → validate |
| `app/services/ssh_service.py` | Paramiko SSH wrapper: exec, stream, upload |
| `app/services/offline_assets.py` | Docker binary + firmware image cache management |
| `app/utils/progress_parser.py` | Parse install.sh/test.sh output → structured step events |
| `app/utils/error_handler.py` | French error messages loader |
| `app/utils/error_messages.json` | All operator-facing error messages (French) |
| `app/utils/checklist.json` | Pre-flight checklist items (French) |

### Assets (scripts that run on the Pi)

| File | Purpose |
|------|---------|
| `app/assets/install.sh` | 13-step firmware installation script |
| `app/assets/sdr/test.sh` | 3-step SDR validation test script |
| `app/assets/sdr/config.py` | Shared SDR config (frequency, gain, thresholds) |
| `app/assets/sdr/rx_tone.py` | RF receiver + FFT analysis (runs on Pi) |
| `app/assets/sdr/tx_tone.py` | RF transmitter (runs on desktop) |

---

## Communication Protocol

### Frontend → Backend (HTTP)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /install` | Start install | Returns `{success, install_id}` |
| `GET /install/{id}/progress` | SSE stream | Events until completion |
| `POST /sdr-test` | Start SDR test | Returns `{success, test_id}` |
| `GET /sdr-test/{id}/progress` | SSE stream | Events until completion |
| `POST /settings/test` | Test SSH | Returns `{success, message, latency_ms}` |
| `POST /settings/test-ghcr` | Test GHCR | Returns `{success, message}` |
| `GET /checklist` | Get checklist | Returns `[{id, label}]` |
| `POST /auth/login` | Login | Returns `{success}` or `{success: false, error}` |
| `GET /cache` | Cache status | Returns `{docker_binaries, firmware_image, firmware_tag}` |
| `DELETE /cache` | Clear cache | Removes firmware tar/digest/version |

### Backend → Frontend (SSE Events)

All events are JSON strings on the SSE stream:

```json
{"type": "prep_step",        "data": {"step_id": "upload_script", "status": "in_progress"}}
{"type": "step_update",      "data": {"step_number": 3, "status": "pass", "duration": 2.1}}
{"type": "install_complete",  "data": {"result": "pass", "steps": [...], "version": "1.2.3"}}
{"type": "install_error",     "data": {"error": "SSH failed", "operator_message": "..."}}
{"type": "test_complete",     "data": {"result": "pass", "metrics": {...}}}
{"type": "test_error",        "data": {"error": "...", "operator_message": "..."}}
```

Event types by operation:

| Install | SDR Test |
|---------|----------|
| `prep_step` | `prep_step` |
| `step_update` | `step_update` |
| `install_complete` | `test_complete` |
| `install_error` | `test_error` |

---

## Install Flow (18 unified steps)

The frontend shows one continuous checklist. Behind the scenes, steps 1-5 are "prep" (run on desktop), steps 6-18 are "install" (run on Pi via install.sh).

### Prep Phase (desktop-side)

| # | ID | Label | What happens |
|---|-----|-------|-------------|
| 1 | `prepare_docker` | Préparer les binaires Docker | Download `docker-27.5.1.tgz` (aarch64) if not cached |
| 2 | `prepare_firmware` | Préparer l'image firmware | GHCR login, pull image, save as tar if not cached |
| 3 | `upload_script` | Transférer le script d'installation | SFTP `install.sh` → `/tmp/install.sh` |
| 4 | `upload_docker` | Transférer les binaires Docker | SFTP docker tar → `/tmp/docker-static.tar.gz` (skipped if Docker already on Pi) |
| 5 | `upload_firmware` | Transférer l'image firmware | SFTP firmware tar → `/tmp/firmware.tar` (~500MB-1GB) |

### Install Phase (Pi-side, via install.sh)

| # | ID | Label | What happens |
|---|-----|-------|-------------|
| 6 | `set_hostname` | Définir le nom de l'appareil | `hostnamectl set-hostname T3S-<serial>` |
| 7 | `expand_partition` | Étendre la partition SD | `parted` + `resize2fs` on root partition |
| 8 | `configure_network` | Configurer le réseau | Set default route + DNS (online mode only) |
| 9 | `docker_install` | Installer Docker | Extract static binaries, create systemd services |
| 10 | `create_dirs` | Créer les répertoires | `/data/logs`, `/data/scan_results`, `/opt/t3shield` |
| 11 | `write_config` | Écrire la configuration | Default `/data/config.json` |
| 12 | `registry_login` | Connexion au registre | Skipped in offline mode |
| 13 | `pull_image` | Télécharger l'image firmware | `docker load < /tmp/firmware.tar` |
| 14 | `install_update_script` | Installer le script de mise à jour | OTA update script → `/opt/t3shield/update.sh` |
| 15 | `start_container` | Démarrer le conteneur | `docker run --privileged --network host ...` |
| 16 | `health_check` | Vérification de santé | Poll `localhost:8080/api/system/ping` (120s timeout) |
| 17 | `sdr_warmup` | Préchauffage SDR | POST `localhost:8080/api/sdr/warmup` |
| 18 | `sdr_verify` | Vérifier le statut SDR | Poll `/api/sdr/status` until "ready" (30s) |

---

## SDR Test Flow (6 unified steps)

Tests that the Pi's B210 SDR can receive a known signal from the desktop's B210 SDR.

### Prep Phase (desktop-side)

| # | ID | Label | What happens |
|---|-----|-------|-------------|
| 1 | `check_desktop_sdr` | Vérifier le SDR du poste | Run `uhd_find_devices`, verify B210 present |
| 2 | `upload_test_scripts` | Transférer les scripts de test | SFTP `config.py`, `rx_tone.py`, `test.sh` → `/tmp/sdr/` |
| 3 | `start_transmitter` | Démarrer l'émetteur | Start `tx_tone.py` subprocess (884 MHz + 100 kHz tone) |

### Test Phase (Pi-side, via test.sh)

| # | ID | Label | What happens |
|---|-----|-------|-------------|
| 4 | `init_receiver` | Initialiser le récepteur SDR | Find UHD images, verify B210 on Pi |
| 5 | `run_test` | Capturer et analyser le signal RF | Run `rx_tone.py` for 5s, capture RF, FFT analysis |
| 6 | `validate_results` | Valider les résultats | Check SNR >= 15 dB, freq error <= 5 kHz |

### SDR Parameters

| Parameter | Value |
|-----------|-------|
| Center frequency | 884 MHz |
| Tone offset | 100 kHz |
| Sample rate | 1 MS/s |
| Capture duration | 5 seconds |
| SNR threshold | 15 dB |
| Frequency tolerance | 5 kHz |

---

## Session Workflow

The operator workflow enforced by the frontend:

```
Login (op / 123)
  ↓
Pre-flight Checklist (4 items, all must be Oui)
  ↓
Session Started (timer running)
  ↓
┌─→ Enter Serial Number
│     ↓
│   Programming (18 steps, real-time progress)
│     ↓
│   PASS → "Appareil suivant" (device count +1) ─→ back to serial input
│   FAIL → "Réessayer" or "Autre appareil"
│     ↓
│   (optional) SDR Test (6 steps)
│     ↓
└─── Next device
  ↓
Terminer la session (or Pause/Reprendre)
```

---

## Offline Asset Cache

Location: `~/.t3shield-installer/` on the desktop.

| File | Size | Purpose |
|------|------|---------|
| `docker-static.tgz` | ~60 MB | Docker CE 27.5.1 static binaries (aarch64) |
| `docker-static/` | extracted | Ready-to-upload binaries |
| `firmware.tar` | 400 MB - 1 GB | Docker image saved as tar |
| `firmware-version.txt` | text | Image URI (for display) |
| `firmware-digest.txt` | text | Manifest digest (for smart cache invalidation) |

Cache is populated on first install. Subsequent installs skip download. Use "Rafraichir l'image" in Settings or `DELETE /cache` to force re-download.

---

## Error Handling

All errors surfaced to the operator are in **French**, loaded from `error_messages.json`.

| Layer | How errors flow |
|-------|----------------|
| SSH connection fails | `ssh_service` → `error_handler.get_connection_message()` → SSE `install_error` event with `operator_message` |
| Install step fails | `install.sh` output → `progress_parser` → step marked `fail` → `error_handler.get_operator_message()` enriches message |
| Frontend network error | Caught in `DeviceProgrammer.tsx` → French fallback: "Une erreur est survenue. Réessayez ou signalez au responsable." |
| Prep step fails | `installer.py`/`sdr_tester.py` → `error_handler.get_prep_message()` → SSE `prep_step` with `fail` status |

---

## Backend Threading Model

Install and SDR test operations run in **daemon threads** (not async). This is because:
- SSH operations (paramiko) are blocking
- Subprocesses (docker, uhd tools) are blocking
- The SSE endpoint reads from an in-memory event list

```
POST /install
  → Validate request
  → Create entry in active_installs dict
  → Spawn daemon thread: run_install(serial, settings, emit_callback)
  → Return {install_id}

GET /install/{id}/progress
  → StreamingResponse (SSE)
  → Loop: yield events from active_installs[id].events
  → Break when status = "completed" or "failed"
  → Auto-cleanup after 60s
```
