import { connectSSH } from './ssh';
import { Settings, StepUpdateEvent, InstallResult } from './types';
import { readFileSync } from 'fs';
import { join } from 'path';

type EmitFn = (event: string, data: StepUpdateEvent | InstallResult | { error: string }) => void;

function getInstallScript(): string {
  try {
    return readFileSync(join(process.cwd(), 'src', 'assets', 'install.sh'), 'utf-8');
  } catch {
    return readFileSync(join(process.cwd(), 'assets', 'install.sh'), 'utf-8');
  }
}

// Parse progress lines like: [1/11] Set device hostname — PASS (Hostname set to T3S-12345)
// Or in-progress: [6/11] Pull firmware image...
function parseProgressLine(line: string): StepUpdateEvent | null {
  // Match PASS lines: [N/11] label — PASS (message)
  const passMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+PASS\s*\((.+?)\)/);
  if (passMatch) {
    return {
      stepNumber: parseInt(passMatch[1]),
      status: 'pass',
      message: passMatch[3],
    };
  }

  // Match FAIL lines: [N/11] label — FAIL: message
  const failMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+FAIL:\s*(.*)/);
  if (failMatch) {
    return {
      stepNumber: parseInt(failMatch[1]),
      status: 'fail',
      message: failMatch[3],
    };
  }

  // Match in-progress lines: [N/11] label...
  const progressMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\.{3}/);
  if (progressMatch) {
    return {
      stepNumber: parseInt(progressMatch[1]),
      status: 'in_progress',
      message: progressMatch[2].trim(),
    };
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

  try {
    conn = await connectSSH({
      host: settings.deviceIp,
      username: settings.sshUsername,
      password: settings.sshPassword,
      timeout: 10000,
    });

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    // Upload install script
    const script = getInstallScript();
    await conn.uploadFile(script, '/tmp/install.sh');

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    // Build command
    const envVars = [
      settings.ghcrUsername ? `GHCR_USER=${settings.ghcrUsername}` : '',
      settings.ghcrToken ? `GHCR_TOKEN=${settings.ghcrToken}` : '',
      settings.firmwareImage ? `IMAGE=${settings.firmwareImage}` : '',
    ].filter(Boolean).join(' ');

    const command = `sudo ${envVars} bash /tmp/install.sh --hostname ${hostname} --json 2>&1`;

    let finalJson: InstallResult | null = null;
    let jsonBuffer = '';
    let collectingJson = false;
    const stepTimers = new Map<number, number>();

    // Set up timeout
    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Installation timed out after 5 minutes')), timeoutMs);
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Installation aborted'));
        });
      }
    });

    const installPromise = conn.execStream(
      command,
      (data: string) => {
        const lines = data.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Check for JSON result
          if (trimmed.startsWith('{') && trimmed.includes('"operation"')) {
            try {
              finalJson = JSON.parse(trimmed);
              continue;
            } catch {
              collectingJson = true;
              jsonBuffer = trimmed;
              continue;
            }
          }

          if (collectingJson) {
            jsonBuffer += trimmed;
            try {
              finalJson = JSON.parse(jsonBuffer);
              collectingJson = false;
              continue;
            } catch {
              continue;
            }
          }

          // Parse progress
          const update = parseProgressLine(trimmed);
          if (update) {
            if (update.status === 'in_progress') {
              stepTimers.set(update.stepNumber, Date.now());
            } else if (update.status === 'pass' || update.status === 'fail') {
              const startTime = stepTimers.get(update.stepNumber);
              if (startTime) {
                update.duration = (Date.now() - startTime) / 1000;
              }
            }
            emit('step_update', update);
          }
        }
      },
      (data: string) => {
        // stderr lines are also progress
        const lines = data.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const update = parseProgressLine(trimmed);
          if (update) {
            if (update.status === 'in_progress') {
              stepTimers.set(update.stepNumber, Date.now());
            } else if (update.status === 'pass' || update.status === 'fail') {
              const startTime = stepTimers.get(update.stepNumber);
              if (startTime) {
                update.duration = (Date.now() - startTime) / 1000;
              }
            }
            emit('step_update', update);
          }
        }
      }
    );

    await Promise.race([installPromise, timeoutPromise]);

    if (finalJson) {
      emit('install_complete', finalJson);
      return finalJson;
    }

    // No JSON result — construct one
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
  }
}
