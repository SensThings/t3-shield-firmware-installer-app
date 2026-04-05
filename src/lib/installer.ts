import { connectSSH } from './ssh';
import { Settings, StepUpdateEvent, InstallResult } from './types';
import { readFileSync } from 'fs';
import { join } from 'path';

type EmitFn = (event: string, data: StepUpdateEvent | InstallResult | { error: string }) => void;

function log(msg: string, ...args: unknown[]) {
  console.log(`[installer] ${msg}`, ...args);
}

function logError(msg: string, ...args: unknown[]) {
  console.error(`[installer] ${msg}`, ...args);
}

function getInstallScript(): string {
  // Try multiple paths (dev vs standalone build)
  const paths = [
    join(process.cwd(), 'src', 'assets', 'install.sh'),
    join(process.cwd(), 'assets', 'install.sh'),
  ];
  for (const p of paths) {
    try {
      const content = readFileSync(p, 'utf-8');
      log('Loaded install.sh from %s (%d bytes)', p, content.length);
      return content;
    } catch {
      // try next
    }
  }
  throw new Error('install.sh not found in any expected location');
}

// Parse progress lines like:
//   [1/11] Set device hostname...           → in_progress
//   [1/11] Set device hostname — PASS (msg) → pass
//   [1/11] Set device hostname — FAIL: msg  → fail
//   [1/11] Set device hostname — SKIPPED    → skipped
function parseProgressLine(line: string): StepUpdateEvent | null {
  const passMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+PASS\s*\((.+?)\)/);
  if (passMatch) {
    return { stepNumber: parseInt(passMatch[1]), status: 'pass', message: passMatch[3] };
  }

  const failMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+FAIL:\s*(.*)/);
  if (failMatch) {
    return { stepNumber: parseInt(failMatch[1]), status: 'fail', message: failMatch[3] };
  }

  const skippedMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+SKIPPED/);
  if (skippedMatch) {
    return { stepNumber: parseInt(skippedMatch[1]), status: 'skipped', message: 'Skipped' };
  }

  const progressMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\.{3}/);
  if (progressMatch) {
    return { stepNumber: parseInt(progressMatch[1]), status: 'in_progress', message: progressMatch[2].trim() };
  }

  return null;
}

export async function runInstall(
  serialNumber: string,
  settings: Settings,
  emit: EmitFn,
  abortSignal?: AbortSignal
): Promise<InstallResult> {
  const hostname = `T3S-${serialNumber}`;
  let conn;

  log('Starting install for %s (host: %s)', hostname, settings.deviceIp);

  try {
    log('Connecting via SSH to %s@%s...', settings.sshUsername, settings.deviceIp);
    conn = await connectSSH({
      host: settings.deviceIp,
      username: settings.sshUsername,
      password: settings.sshPassword,
      timeout: 10000,
    });
    log('SSH connected');

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    // Upload install script
    log('Uploading install.sh...');
    const script = getInstallScript();
    await conn.uploadFile(script, '/tmp/install.sh');
    log('Upload complete');

    // Verify upload
    const verify = await conn.exec('wc -l /tmp/install.sh');
    log('Uploaded file: %s', verify.stdout.trim());

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    // Build command
    const envVars = [
      settings.ghcrUsername ? `GHCR_USER=${settings.ghcrUsername}` : '',
      settings.ghcrToken ? `GHCR_TOKEN=${settings.ghcrToken}` : '',
      settings.firmwareImage ? `IMAGE=${settings.firmwareImage}` : '',
    ].filter(Boolean).join(' ');

    const command = `sudo ${envVars} bash /tmp/install.sh --hostname ${hostname} --json 2>&1`;
    log('Executing: sudo [GHCR_USER=...] [GHCR_TOKEN=...] bash /tmp/install.sh --hostname %s --json', hostname);

    let finalJson: InstallResult | null = null;
    let jsonBuffer = '';
    let collectingJson = false;
    const stepTimers = new Map<number, number>();
    let allOutput = ''; // collect everything for fallback JSON extraction

    // Set up timeout
    const timeoutMs = 15 * 60 * 1000; // 15 minutes — Docker install on fresh Pi can take 10+
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Installation timed out after 15 minutes')), timeoutMs);
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Installation aborted'));
        });
      }
    });

    // Fix invalid JSON like "duration_s":.1 → "duration_s":0.1
    const fixJson = (str: string): string => str.replace(/:(\.\d)/g, ':0$1');

    const tryParseJson = (str: string): InstallResult | null => {
      try {
        const parsed = JSON.parse(fixJson(str));
        if (parsed && typeof parsed === 'object' && 'operation' in parsed) {
          return parsed as InstallResult;
        }
      } catch {
        // not valid JSON
      }
      return null;
    };

    const processData = (data: string) => {
      allOutput += data;

      // If we're collecting JSON, append raw data (not line-split)
      // and try to parse before splitting into lines
      if (collectingJson) {
        jsonBuffer += data;
        const parsed = tryParseJson(jsonBuffer);
        if (parsed) {
          finalJson = parsed;
          collectingJson = false;
          log('Received final JSON result (multi-chunk): %s', finalJson.result);
          return;
        }
        // Check if we've gone past the JSON (hit non-JSON content)
        // The JSON ends with }] } — if we see a newline after }, try to extract
        const lastBrace = jsonBuffer.lastIndexOf('}');
        if (lastBrace > 0) {
          const candidate = jsonBuffer.slice(0, lastBrace + 1);
          const parsed2 = tryParseJson(candidate);
          if (parsed2) {
            finalJson = parsed2;
            collectingJson = false;
            log('Received final JSON result (trimmed): %s', finalJson.result);
            // Process remaining data as normal lines
            const remaining = jsonBuffer.slice(lastBrace + 1);
            for (const line of remaining.split('\n')) {
              const trimmed = line.trim();
              if (trimmed) log('SSH output: %s', trimmed);
            }
            return;
          }
        }
        return;
      }

      const lines = data.split('\n');
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        // Detect JSON start
        if (trimmed.includes('{') && trimmed.includes('"operation"')) {
          const jsonStart = trimmed.indexOf('{');
          const candidate = trimmed.slice(jsonStart);
          const parsed = tryParseJson(candidate);
          if (parsed) {
            finalJson = parsed;
            log('Received final JSON result: %s', finalJson.result);
            continue;
          } else {
            // JSON is split across chunks — collect raw data from here
            collectingJson = true;
            jsonBuffer = candidate;
            log('JSON started (%d chars), collecting...', candidate.length);
            continue;
          }
        }

        // Parse progress
        const update = parseProgressLine(trimmed);
        if (update) {
          log('Step %d: %s — %s', update.stepNumber, update.message, update.status);
          if (update.status === 'in_progress') {
            stepTimers.set(update.stepNumber, Date.now());
          } else if (update.status === 'pass' || update.status === 'fail') {
            const startTime = stepTimers.get(update.stepNumber);
            if (startTime) {
              update.duration = (Date.now() - startTime) / 1000;
            }
          }
          emit('step_update', update);
        } else {
          log('SSH output: %s', trimmed);
        }
      }
    };

    const installPromise = conn.execStream(
      command,
      (data: string) => processData(data),
      (data: string) => processData(data)
    );

    const exitCode = await Promise.race([installPromise, timeoutPromise]);
    log('Install script exited with code: %d', exitCode);

    // Fallback: scan allOutput for JSON if not already found
    if (!finalJson) {
      log('JSON not found during streaming, scanning full output...');
      // Find lines starting with { that contain "operation"
      for (const line of allOutput.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('"operation"')) {
          const parsed = tryParseJson(trimmed);
          if (parsed) {
            finalJson = parsed;
            log('Extracted JSON from full output: %s', finalJson.result);
            break;
          }
        }
      }
    }

    if (finalJson) {
      emit('install_complete', finalJson);
      return finalJson;
    }

    log('No JSON result received from script (output length: %d)', allOutput.length);
    log('=== RAW OUTPUT START ===');
    log(allOutput);
    log('=== RAW OUTPUT END ===');
    const result: InstallResult = {
      operation: 'install',
      image: settings.firmwareImage,
      version: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      result: 'fail',
      steps: [],
    };
    emit('install_complete', result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logError('Install failed: %s', message);
    let errorMsg = message;

    if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('Timed out')) {
      errorMsg = `Cannot reach device at ${settings.deviceIp} — check Ethernet cable`;
    } else if (message.includes('Authentication') || message.includes('auth')) {
      errorMsg = 'Authentication failed — check credentials in Settings';
    }

    emit('install_error', { error: errorMsg });
    throw new Error(errorMsg);
  } finally {
    conn?.close();
    log('SSH connection closed');
  }
}
