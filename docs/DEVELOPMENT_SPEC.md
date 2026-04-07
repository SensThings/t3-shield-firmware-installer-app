# Firmware Installer Web App — Development Specification

## 1. Overview

A desktop web application that allows technicians to program embedded Linux devices with custom firmware. The technician connects a fresh device via Ethernet, enters a serial number, clicks one button, and the app handles everything automatically — file transfers, configuration, and firmware installation — all via SSH.

The app is designed for a production environment where **2,000+ devices** must be programmed by non-technical staff. Simplicity and reliability are paramount.

### Key Constraints

- The target devices have **no internet access**. They connect to the technician's desktop via a direct Ethernet cable only.
- All required files (Docker runtime, firmware image) must be downloaded once on the desktop and transferred to the device over SSH/SFTP.
- The firmware install logic is provided as a shell script (`install.sh`). This app wraps it with a user-friendly UI and handles all file preparation and transfer.
- Docker must be installed on the desktop machine to pull and save the firmware image as a tar file.

---

## 2. Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Technician Desktop                                       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Browser (localhost:3000)                            │  │
│  │  - Serial number input                              │  │
│  │  - One-click install                                │  │
│  │  - Real-time step-by-step progress                  │  │
│  │  - Settings (IP, credentials)                       │  │
│  └──────────────┬──────────────────────────────────────┘  │
│                 │ HTTP + Server-Sent Events                │
│  ┌──────────────▼──────────────────────────────────────┐  │
│  │  Next.js Backend (API Routes + ssh2)                │  │
│  │  - Pull firmware image from registry (once, cached) │  │
│  │  - Download Docker binaries (once, cached)          │  │
│  │  - SSH/SFTP into device                             │  │
│  │  - Upload all files to device                       │  │
│  │  - Execute install script                           │  │
│  │  - Parse progress output, stream to browser         │  │
│  └──────────────┬──────────────────────────────────────┘  │
│                 │ SSH/SFTP over Ethernet                   │
└─────────────────┼─────────────────────────────────────────┘
                  │ Direct Ethernet (e.g., 192.168.137.100)
         ┌────────▼────────┐
         │  Target Device   │
         │  (embedded Linux) │
         │  No internet     │
         └─────────────────┘
```

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 14+ (App Router) | TypeScript, `output: 'standalone'` for Docker |
| Styling | Tailwind CSS | Dark mode by default |
| SSH | `ssh2` npm package | SFTP upload + streaming exec |
| Real-time | Server-Sent Events (SSE) | Via Next.js API route streaming responses |
| Desktop req | Docker | Required on desktop to pull + save firmware image |

---

## 3. Project Setup

### 3.1 Initialize

```bash
npx create-next-app@latest firmware-installer \
  --typescript --tailwind --eslint --app --src-dir --use-npm

cd firmware-installer
npm install ssh2 socket.io socket.io-client
npm install -D @types/ssh2
```

### 3.2 next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',           // Required for Docker deployment
  serverExternalPackages: ['ssh2'], // ssh2 has native modules — must be external
};

export default nextConfig;
```

> **Critical:** Without `serverExternalPackages: ['ssh2']`, the build fails with `non-ecmascript placeable asset` errors because ssh2 contains native crypto modules that Turbopack cannot bundle.

### 3.3 File Structure

```
src/
  app/
    page.tsx                    # Main page — 'use client', renders Header + DeviceProgrammer
    layout.tsx                  # Root layout — dark mode, Geist font
    globals.css                 # Tailwind import
    api/
      install/
        route.ts                # POST: start install, GET: SSE progress stream
      settings/
        test/
          route.ts              # POST: test SSH connection
        test-registry/
          route.ts              # POST: test registry credentials
      cache/
        route.ts                # GET: cache status, DELETE: clear firmware cache
  components/
    Header.tsx                  # Top bar — title, connection indicator, settings gear
    DeviceProgrammer.tsx        # Main UI — serial input, prep steps, install progress, success/fail
    ProgressChecklist.tsx       # Step-by-step checklist with live timers
    SettingsPanel.tsx            # Settings modal — connection, registry, test buttons
  lib/
    types.ts                    # Shared TypeScript types, step definitions, defaults
    settings.ts                 # localStorage persistence (load/save)
    ssh.ts                      # SSH connect, exec, execStream, SFTP upload
    installer.ts                # 3-phase install flow (prepare → upload → install)
    offline-assets.ts           # Docker binaries download + firmware image pull/save/cache
  assets/
    install.sh                  # Bundled install script (provided, do not modify)
```

### 3.4 Key Dependencies

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "ssh2": "^1.17.0"
  },
  "devDependencies": {
    "@types/ssh2": "^1.15.0",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

> `socket.io` is optional — SSE (Server-Sent Events) via streaming API route responses is simpler and doesn't require a separate WebSocket server.

---

## 4. Provided Assets

The following scripts are provided and should be treated as opaque dependencies. The app does not need to understand their internals — only how to invoke them and parse their output.

### 4.1 `install.sh` — First-Time Device Setup

**Location:** Bundle at `src/assets/install.sh`.

**Invocation:**
```bash
sudo bash /tmp/install.sh \
  --image-tar /tmp/firmware.tar \
  --hostname T3S-<serial> \
  --json \
  2>&1
```

**Flags:**
| Flag | Required | Description |
|------|----------|-------------|
| `--hostname <name>` | Yes | Sets the device hostname (e.g., `T3S-12345`) |
| `--image-tar <path>` | Yes | Path to the pre-transferred Docker image tar file |
| `--json` | Yes | Enables structured JSON output on stdout |

No environment variables are passed to the script. The device never contacts any registry — all files are pre-transferred.

**Registry credentials** are used only on the desktop to `docker pull` the firmware image and `docker save` it as a tar file. They are never sent to the device.

**Output Format:**

The script writes progress to **stderr** and a final JSON result to **stdout**. Since the app runs with `2>&1`, both streams are merged. The app must parse both.

Progress lines (stderr):
```
  [1/13] Set device hostname...
  [1/13] Set device hostname — PASS (Hostname set to T3S-12345)
  [2/13] Expand SD card partition...
  [2/13] Expand SD card partition — PASS (Partition already expanded)
  ...
  [8/13] Pull firmware image — FAIL: No space left on device
  [9/13] Install update script — SKIPPED
```

Line format patterns:
- **In progress:** `[N/TOTAL] Label...`
- **Pass:** `[N/TOTAL] Label — PASS (message)`
- **Fail:** `[N/TOTAL] Label — FAIL: message`
- **Skipped:** `[N/TOTAL] Label — SKIPPED`

Note: The `—` is a Unicode em-dash (U+2014), not a regular hyphen.

Final JSON result (stdout, single line):
```json
{
  "operation": "install",
  "image": "ghcr.io/sensthings/t3shield-firmware:latest",
  "version": "1.2.0",
  "started_at": "2026-04-05T10:00:00Z",
  "finished_at": "2026-04-05T10:05:30Z",
  "result": "pass",
  "steps": [
    {
      "id": 1,
      "name": "set_hostname",
      "label": "Set device hostname",
      "status": "pass",
      "message": "Hostname set to T3S-12345",
      "duration_s": 0.1
    }
  ]
}
```

### 4.2 `update.sh` — Firmware Update

Similar to `install.sh` but for updating devices that are already programmed. The install script embeds a copy on the device during setup. The installer app does not invoke this directly.

### 4.3 Install Steps

The install script executes these steps in order. The app should display them as a progress checklist:

| # | ID | Label | Notes |
|---|-----|-------|-------|
| 1 | `set_hostname` | Set device hostname | |
| 2 | `expand_partition` | Expand SD card partition | Expands root partition to fill SD card |
| 3 | `configure_network` | Configure network | Reports "Offline mode" in offline install |
| 4 | `docker_install` | Install Docker | Installed from static binaries uploaded by the app |
| 5 | `create_dirs` | Create data directories | |
| 6 | `write_config` | Write default config | |
| 7 | `registry_login` | Login to registry | Reports "Skipped (offline mode)" |
| 8 | `pull_image` | Pull firmware image | Uses `docker load` from the uploaded tar |
| 9 | `install_update_script` | Install update script | |
| 10 | `start_container` | Start container | |
| 11 | `health_check` | Health check | |
| 12 | `sdr_warmup` | Hardware warmup | |
| 13 | `sdr_verify` | Verify hardware status | |

---

## 5. Implementation Guide

### 5.1 Types (`src/lib/types.ts`)

```typescript
export interface Settings {
  deviceIp: string;
  sshUsername: string;
  sshPassword: string;
  registryUsername: string;
  registryToken: string;
  firmwareImage: string;
}

// All settings are configurable via the Settings panel in the UI.
// These are just the defaults — technicians can change them per environment.
export const DEFAULT_SETTINGS: Settings = {
  deviceIp: '192.168.137.100',
  sshUsername: 'dragon',
  sshPassword: 'Sensthings@012',
  registryUsername: '',
  registryToken: '',
  firmwareImage: 'ghcr.io/sensthings/t3shield-firmware:latest',
};

export type StepStatus = 'pending' | 'in_progress' | 'pass' | 'fail' | 'skipped';

export interface InstallStep {
  id: string;
  number: number;
  label: string;
  status: StepStatus;
  message?: string;
  duration?: number;
  startedAt?: number;
}

// Preparation steps (file download + upload)
export const PREP_STEPS: { id: string; label: string }[] = [
  { id: 'prepare_docker', label: 'Prepare Docker binaries' },
  { id: 'prepare_firmware', label: 'Prepare firmware image' },
  { id: 'upload_script', label: 'Upload install script' },
  { id: 'upload_docker', label: 'Upload Docker binaries' },
  { id: 'upload_firmware', label: 'Upload firmware image' },
];

// Install steps (executed on device by install.sh)
export const INSTALL_STEPS: { id: string; label: string }[] = [
  { id: 'set_hostname', label: 'Set device hostname' },
  { id: 'expand_partition', label: 'Expand SD card partition' },
  // ... all 13 steps from section 4.3
];
```

### 5.2 SSH Module (`src/lib/ssh.ts`)

Build a module that wraps the `ssh2` package with three capabilities:

```typescript
export interface SSHConnection {
  client: Client;
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; code: number }>;
  execStream: (
    cmd: string,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void
  ) => Promise<number>;
  uploadFile: (content: string, remotePath: string) => Promise<void>;
  close: () => void;
}
```

**File upload must use SFTP:**
```typescript
const uploadFile = (content: string, remotePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      const writeStream = sftp.createWriteStream(remotePath);
      writeStream.on('close', () => { sftp.end(); resolve(); });
      writeStream.on('error', (e) => { sftp.end(); reject(e); });
      writeStream.write(content);
      writeStream.end();
    });
  });
};
```

For large binary files, use `createReadStream` piped to SFTP with progress tracking:

```typescript
import { createReadStream, statSync } from 'fs';

async function uploadLargeFile(conn, localPath, remotePath, onProgress) {
  const size = statSync(localPath).size;
  return new Promise((resolve, reject) => {
    conn.client.sftp((err, sftp) => {
      const readStream = createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);
      let transferred = 0;
      readStream.on('data', (chunk) => {
        transferred += chunk.length;
        onProgress(Math.round((transferred / size) * 100));
      });
      writeStream.on('close', () => { sftp.end(); resolve(); });
      readStream.pipe(writeStream);
    });
  });
}
```

### 5.3 Offline Asset Preparation (`src/lib/offline-assets.ts`)

Two assets must be cached on the desktop:

**Docker static binaries (~60MB):**
```typescript
const DOCKER_URL = 'https://download.docker.com/linux/static/stable/aarch64/docker-27.5.1.tgz';
const CACHE_DIR = join(process.env.HOME || '/tmp', '.firmware-installer');

// Download with curl, extract with tar
execSync(`curl -fSL -o "${tgzPath}" "${DOCKER_URL}"`);
execSync(`tar xzf "${tgzPath}" -C "${extractDir}"`);
```

**Firmware image (~300MB-1GB):**
```typescript
// Login, pull for target arch, save as tar
execSync(`echo "${token}" | docker login ghcr.io -u "${username}" --password-stdin`);
execSync(`docker pull --platform linux/arm64 "${image}"`);
execSync(`docker save "${image}" -o "${tarPath}"`);
```

**Cache directory:**
```
~/.firmware-installer/
  docker-static.tgz        # Downloaded once (~60MB)
  docker-static/docker/     # Extracted binaries
  firmware.tar              # Saved image (~300MB-1GB)
  firmware-version.txt      # Image tag for cache invalidation
```

**Security:** Never include raw `execSync` error output in error messages — it can contain tokens and credentials. Use sanitized messages:
```typescript
try {
  execSync(`echo "${token}" | docker login ...`);
} catch {
  throw new Error('Registry login failed — check username and token in Settings');
}
```

### 5.4 Install Flow (`src/lib/installer.ts`)

The main function runs three phases:

```typescript
type EmitFn = (event: string, data: any) => void;

export async function runInstall(
  serialNumber: string,
  settings: Settings,
  emit: EmitFn
): Promise<InstallResult> {

  // === PHASE 1: Prepare offline assets on desktop ===
  emit('prep_step', { stepId: 'prepare_docker', status: 'in_progress' });
  await prepareDockerBinaries();
  emit('prep_step', { stepId: 'prepare_docker', status: 'pass' });

  emit('prep_step', { stepId: 'prepare_firmware', status: 'in_progress' });
  await prepareFirmwareImage(settings.firmwareImage, settings.registryUsername, settings.registryToken);
  emit('prep_step', { stepId: 'prepare_firmware', status: 'pass' });

  // === PHASE 2: Connect and upload to device ===
  const conn = await connectSSH({ host: settings.deviceIp, ... });

  // Upload install.sh via SFTP
  await conn.uploadFile(getInstallScript(), '/tmp/install.sh');

  // Skip Docker binaries upload if Docker already on device
  const dockerCheck = await conn.exec('command -v docker && docker --version');
  if (dockerCheck.code === 0 && dockerCheck.stdout.includes('Docker')) {
    emit('prep_step', { stepId: 'upload_docker', status: 'pass', message: 'Docker already installed' });
  } else {
    await uploadDirectory(conn, dockerDir, '/tmp/docker-static');
  }

  // Upload firmware tar with progress
  await uploadLargeFile(conn, firmwareTarPath, '/tmp/firmware.tar', (pct) => {
    emit('prep_step', { stepId: 'upload_firmware', status: 'in_progress', message: `Uploading (${pct}%)` });
  });

  // === PHASE 3: Run install script ===
  const command = `sudo bash /tmp/install.sh --image-tar /tmp/firmware.tar --hostname DEVICE-${serialNumber} --json 2>&1`;

  conn.execStream(command,
    (data) => { /* parse progress lines, emit step_update events */ },
    (data) => { /* same parsing for stderr */ }
  );
}
```

### 5.5 Progress Line Parser

```typescript
function parseProgressLine(line: string): StepUpdateEvent | null {
  // PASS: [N/TOTAL] Label — PASS (message)
  const passMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+PASS\s*\((.+?)\)/);
  if (passMatch) return { stepNumber: parseInt(passMatch[1]), status: 'pass', message: passMatch[3] };

  // FAIL: [N/TOTAL] Label — FAIL: message
  const failMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+FAIL:\s*(.*)/);
  if (failMatch) return { stepNumber: parseInt(failMatch[1]), status: 'fail', message: failMatch[3] };

  // SKIPPED: [N/TOTAL] Label — SKIPPED
  const skipMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+SKIPPED/);
  if (skipMatch) return { stepNumber: parseInt(skipMatch[1]), status: 'skipped' };

  // In progress: [N/TOTAL] Label...
  const progMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\.{3}/);
  if (progMatch) return { stepNumber: parseInt(progMatch[1]), status: 'in_progress' };

  return null;
}
```

### 5.6 JSON Result Parser

The final JSON line needs special handling:

```typescript
// Fix invalid JSON: "duration_s":.1 → "duration_s":0.1
const fixJson = (str: string): string => str.replace(/:(\.\d)/g, ':0$1');

const tryParseJson = (str: string): InstallResult | null => {
  try {
    const parsed = JSON.parse(fixJson(str));
    if (parsed && 'operation' in parsed) return parsed;
  } catch {}
  return null;
};
```

**Multi-chunk collection:** The JSON can arrive split across SSH data events. When a line contains `{` and `"operation"` but fails to parse, set a `collectingJson` flag and buffer subsequent data. After each chunk, try parsing the buffer. Also try trimming at the last `}` — subsequent chunks may contain non-JSON lines like `=====`.

**Fallback:** After the script exits, scan the full output buffer for a line starting with `{` that contains `"operation"`.

### 5.7 API Route: Install (`src/app/api/install/route.ts`)

```typescript
// In-memory store for active installations
const activeInstalls = new Map<string, {
  events: Array<{ type: string; data: unknown; timestamp: number }>;
  status: 'running' | 'completed' | 'failed';
  result?: InstallResult;
  error?: string;
}>();

// POST — start install (returns immediately, runs in background)
export async function POST(request: NextRequest) {
  const { serialNumber, settings } = await request.json();
  const installId = `${serialNumber}-${Date.now()}`;

  activeInstalls.set(installId, { events: [], status: 'running' });

  // Fire and forget — don't await
  runInstall(serialNumber, settings, (event, data) => {
    const install = activeInstalls.get(installId);
    if (install) install.events.push({ type: event, data, timestamp: Date.now() });
  }).catch(err => { /* mark as failed */ });

  return NextResponse.json({ success: true, installId });
}

// GET — SSE stream for progress
export async function GET(request: NextRequest) {
  const installId = request.nextUrl.searchParams.get('installId');
  const install = activeInstalls.get(installId);

  const stream = new ReadableStream({
    start(controller) {
      let lastIndex = 0;
      const interval = setInterval(() => {
        // Send new events
        while (lastIndex < install.events.length) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(install.events[lastIndex])}\n\n`));
          lastIndex++;
        }
        // Close when done
        if (install.status !== 'running') {
          clearInterval(interval);
          controller.close();
        }
      }, 100);
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

### 5.8 Frontend: DeviceProgrammer Component

The main component manages five views: `idle` → `serial_input` → `programming` → `success`/`failure`.

```typescript
'use client';

export default function DeviceProgrammer({ settings }: { settings: Settings }) {
  const [view, setView] = useState<'idle' | 'serial_input' | 'programming' | 'success' | 'failure'>('idle');
  const [prepSteps, setPrepSteps] = useState<PrepStep[]>([]);
  const [steps, setSteps] = useState<InstallStep[]>([]);

  const startInstall = async () => {
    // POST to /api/install
    const res = await fetch('/api/install', { method: 'POST', body: JSON.stringify({ serialNumber, settings }) });
    const { installId } = await res.json();

    // Subscribe to SSE stream
    const evtSource = new EventSource(`/api/install?installId=${installId}`);
    evtSource.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'prep_step') updatePrepStep(parsed.data);
      if (parsed.type === 'step_update') updateInstallStep(parsed.data);
      if (parsed.type === 'install_complete') { setResult(parsed.data); setView('success'); evtSource.close(); }
      if (parsed.type === 'install_error') { setError(parsed.data.error); setView('failure'); evtSource.close(); }
    };
  };
}
```

The progress screen shows **prep steps first** (downloading, uploading), then **install steps** (from the script) once all prep steps are done.

### 5.9 Settings Persistence

Settings live in `localStorage` only — no server-side storage:

```typescript
// src/lib/settings.ts
const STORAGE_KEY = 'firmware-installer-settings';

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
```

Settings are sent with each install request from the client to the API route.

---

## 6. User Interface

### 6.1 Design Principles

- **Dark mode** — `bg-zinc-950 text-zinc-100` base, easier on eyes during long sessions
- **Desktop only** — no mobile responsiveness needed
- **Minimal** — internal tool for technicians, not a consumer product
- **One-button workflow** — enter serial, click Start, watch progress
- **Status colors:** `emerald-500`=pass, `red-500`=fail, `amber-500`=in-progress, `zinc-700`=pending

### 6.2 Screens

#### Home Screen
A single centered button: **"Program New Device"**. If registry credentials are not configured, show a warning and disable the button.

#### Serial Number Input (Modal)
- Text input for serial number
- Validation: `^[a-zA-Z0-9]{3,}$`
- Preview: "Hostname will be: DEVICE-{serial}"
- Auto-focus input on open, Enter submits, Escape cancels

#### Progress Screen
Two sections displayed sequentially:

**Preparation Phase** (5 steps) — download/cache check, file uploads with percentage:
```
  [spinner] Uploading firmware image (45%)...
  [check]   Docker binaries — already installed on device
```

**Installation Phase** (13 steps) — streamed from install script:
```
  [check]  1. Set device hostname          0.2s
              Hostname set to T3S-12345
  [spinner] 2. Expand SD card partition    12.3s...
  [grey]   3. Configure network
  ...
```

Each step shows: status icon, number, label, elapsed/duration, message.

#### Success Screen
Large green checkmark, hostname, firmware version, "Program Another Device" button.

#### Failure Screen
Large red X, failed step name + error, "Retry" and "Program Another" buttons.

### 6.3 Header
- App title + icon
- Connection indicator: green/red dot + device IP (SSH ping every 30s)
- Settings gear icon

### 6.4 Settings Panel (Modal)

**Connection section:**
| Field | Default | Description |
|-------|---------|-------------|
| Device IP | `192.168.137.100` | Target device's static Ethernet IP |
| SSH Username | `dragon` | SSH login user |
| SSH Password | `Sensthings@012` | SSH login password |

- "Test Connection" button

**Container Registry section:**
| Field | Default | Description |
|-------|---------|-------------|
| Registry Username | *(empty, must be set)* | GitHub username for pulling firmware image on desktop |
| Registry Token | *(empty, must be set)* | GitHub PAT with `read:packages` scope |
| Firmware Image | `ghcr.io/sensthings/t3shield-firmware:latest` | Full image ref including tag |

- "Test Registry" button
- "Refresh Image" button — clears cached firmware tar

---

## 7. API Design

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/install` | Start install (returns `installId`) |
| GET | `/api/install?installId=...` | SSE stream for progress events |
| POST | `/api/settings/test` | Test SSH connection |
| POST | `/api/settings/test-registry` | Test registry credentials |
| GET | `/api/cache` | Get cache status |
| DELETE | `/api/cache` | Clear firmware cache |

### SSE Event Types

```
prep_step      → { stepId, status, message }
step_update    → { stepNumber, status, message, duration }
install_complete → { operation, result, steps, version, ... }
install_error  → { error }
done           → { status, result, error }
```

---

## 8. Asset Preparation

### 8.1 Docker Static Binaries
- Source: `https://download.docker.com/linux/static/stable/<arch>/docker-<version>.tgz`
- Download once, extract, cache at `~/.firmware-installer/docker-static/`
- ~60MB, reused for all devices

### 8.2 Firmware Docker Image
1. `docker login ghcr.io` (using credentials from Settings)
2. `docker pull --platform linux/<target-arch> <image>`
3. `docker save <image> -o ~/.firmware-installer/firmware.tar`
- ~300MB-1GB, cached until "Refresh Image" is clicked

### 8.3 Skip Logic
Before uploading Docker binaries, SSH-check if Docker is already on device:
```bash
command -v docker && docker --version
```
If yes, skip the 60MB upload.

---

## 9. Install Flow

### Phase 1: Prepare (on desktop)
1. Check/download Docker static binaries (~60MB, one-time)
2. Check/pull+save firmware image (~300MB-1GB, one-time)

### Phase 2: Upload (desktop → device via SFTP)
3. Upload `install.sh` (~20KB)
4. Upload Docker binaries (~60MB) — skip if Docker on device
5. Upload firmware tar (~300MB-1GB) with progress

### Phase 3: Install (on device via SSH exec)
6. Execute: `sudo bash /tmp/install.sh --image-tar /tmp/firmware.tar --hostname T3S-<serial> --json 2>&1`
7. Stream + parse progress, emit events
8. Parse JSON result
9. Display success/failure

### Timeouts
| Operation | Timeout |
|-----------|---------|
| SSH connection | 10 seconds |
| SFTP file upload | No timeout (progress-based) |
| Install script | 15 minutes |

---

## 10. Error Handling

| Scenario | UI Message |
|----------|------------|
| Device unreachable | "Cannot reach device at {IP} — check Ethernet cable" |
| Auth failed | "Authentication failed — check credentials in Settings" |
| Connection lost mid-install | "Connection lost — check device" + retry |
| Install script fails | Show failed step with error message |
| Registry creds missing | Block Start button, show warning |
| Docker not on desktop | "Docker is not installed. Install Docker and try again." |
| Registry login fails | "Registry login failed — check credentials" |
| Script timeout | "Installation timed out" + retry |

**Security:** Never include raw command output in error messages. Credentials and tokens can appear in stderr. Always use sanitized, hardcoded error strings.

---

## 11. Containerization

### Dockerfile

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### .dockerignore
```
node_modules
.next
.git
*.md
.env*
```

### CI/CD (GitHub Actions)
On push to `main` or version tag → build image → push to registry with tags: `latest`, semver, SHA.

### Running
```bash
docker run -d --name firmware-installer --network host <registry>/firmware-installer:latest
```

`--network host` is required so the container can reach devices on the local Ethernet subnet.

---

## 12. Development Checklist

### Phase 1: Scaffold
- [ ] `create-next-app` with TypeScript + Tailwind
- [ ] Install `ssh2`, `@types/ssh2`
- [ ] Configure `next.config.ts` (standalone output, ssh2 external)
- [ ] Set up dark mode layout
- [ ] Create file structure per section 3.3

### Phase 2: Settings & Connection
- [ ] `types.ts` — Settings interface, defaults, step definitions
- [ ] `settings.ts` — localStorage load/save
- [ ] `SettingsPanel.tsx` — connection fields, registry fields
- [ ] `POST /api/settings/test` — SSH connection test
- [ ] `POST /api/settings/test-registry` — registry credential test
- [ ] `Header.tsx` — connection indicator (SSH ping every 30s)

### Phase 3: Asset Preparation
- [ ] `offline-assets.ts` — Docker binaries download + cache
- [ ] `offline-assets.ts` — firmware image pull + save + cache
- [ ] `GET /api/cache` — cache status
- [ ] `DELETE /api/cache` — clear firmware cache
- [ ] "Refresh Image" button in settings

### Phase 4: Install Flow
- [ ] `ssh.ts` — connect, exec, execStream, SFTP upload
- [ ] `installer.ts` — 3-phase install flow
- [ ] Progress line parser (regex for PASS/FAIL/SKIPPED/in-progress)
- [ ] JSON result parser (multi-chunk, fix `.1` → `0.1`, fallback scan)
- [ ] `POST /api/install` — start install
- [ ] `GET /api/install?installId=` — SSE progress stream
- [ ] `DeviceProgrammer.tsx` — serial input, prep steps, install steps
- [ ] `ProgressChecklist.tsx` — step rows with live timers

### Phase 5: Polish
- [ ] Serial validation (`^[a-zA-Z0-9]{3,}$`)
- [ ] Keyboard shortcuts (Enter submit, Escape cancel)
- [ ] Auto-focus serial input
- [ ] Success/failure screens with retry
- [ ] 15-minute install timeout
- [ ] Dockerfile + CI/CD

---

## 13. Lessons Learned

These are practical issues discovered during development and testing. They will save significant debugging time.

### SSH File Upload
- **Do not use heredoc** (`cat > file << 'EOF'`) — breaks on complex shell quoting in the install script.
- **Do not use base64-over-exec** (`echo <b64> | base64 -d > file`) — hangs on large files because `stream.end()` doesn't reliably signal EOF to the remote shell.
- **Use SFTP** — it works reliably for any file size and content.

### Install Script Output Parsing
- The JSON result line can arrive **split across multiple SSH data chunks** (e.g., 1548 bytes in one chunk, rest in next). Implement multi-chunk JSON collection.
- When collecting JSON across chunks, subsequent data may contain non-JSON lines (e.g., `=====`, `INSTALL COMPLETE`). Try parsing the buffer up to the last `}`.
- The script uses `bc` for durations which outputs `.1` instead of `0.1` — invalid JSON. Normalize with regex: `str.replace(/:(\.\d)/g, ':0$1')`.
- The em-dash `—` (U+2014) in progress lines is a 3-byte UTF-8 character, not ASCII.

### Docker on Target Device
- Fresh devices may not have `iptables` installed. Docker daemon will crash without it. Solution: the install script starts dockerd with `--iptables=false` (safe when containers use `--network host`).
- Docker daemon can take 60+ seconds to start on first boot. Health checks should allow 120 seconds.

### SD Card Partitioning
- Many device OS images ship with a small root partition (e.g., 14GB on a 64GB card). The install script expands the partition before Docker install. `parted` + `resize2fs` on a live filesystem can take 5-10 minutes on SD cards. This is normal.

### Networking
- When the desktop runs in WSL2, it cannot directly reach devices on the Windows Ethernet adapter's subnet. Either run the app natively on Windows, or configure network bridging/port forwarding.
- The header's connection status checker should not poll too aggressively (every 30 seconds is sufficient).

### Next.js Specifics
- `ssh2` must be in `serverExternalPackages` in `next.config.ts` — it has native C++ modules that Turbopack cannot bundle.
- API routes that use Node.js modules (`fs`, `child_process`, `ssh2`) work in App Router route handlers but not in client components.
- The `output: 'standalone'` config is required for Docker deployment — it creates a self-contained `server.js` without needing `node_modules`.
- SSE via `ReadableStream` in route handlers works well for progress streaming without needing socket.io.
