import { connectSSH } from './ssh';
import { Settings, StepUpdateEvent, PrepStepEvent } from './types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface SdrTestResult {
  operation: string;
  started_at: string;
  finished_at: string;
  result: 'pass' | 'fail';
  metrics?: {
    status: string;
    peak_freq_hz: number;
    expected_freq_hz: number;
    freq_error_hz: number;
    snr_db: number;
    snr_threshold_db: number;
    peak_power_db: number;
    noise_floor_db: number;
  };
  steps: {
    id: number;
    name: string;
    label: string;
    status: string;
    message: string | null;
    duration_s: number | null;
  }[];
}

type EmitFn = (event: string, data: StepUpdateEvent | SdrTestResult | PrepStepEvent | { error: string }) => void;

function log(msg: string, ...args: unknown[]) {
  console.log(`[sdr-tester] ${msg}`, ...args);
}

function getSdrAsset(filename: string): string {
  const paths = [
    join(process.cwd(), 'src', 'assets', 'sdr', filename),
    join(process.cwd(), 'assets', 'sdr', filename),
  ];
  for (const p of paths) {
    try {
      return readFileSync(p, 'utf-8');
    } catch { /* try next */ }
  }
  throw new Error(`SDR asset not found: ${filename}`);
}

function getSdrAssetPath(filename: string): string {
  const paths = [
    join(process.cwd(), 'src', 'assets', 'sdr', filename),
    join(process.cwd(), 'assets', 'sdr', filename),
  ];
  for (const p of paths) {
    try {
      readFileSync(p);
      return p;
    } catch { /* try next */ }
  }
  throw new Error(`SDR asset not found: ${filename}`);
}

function parseProgressLine(line: string): StepUpdateEvent | null {
  const passMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+PASS\s*\((.+?)\)/);
  if (passMatch) return { stepNumber: parseInt(passMatch[1]), status: 'pass', message: passMatch[3] };

  const failMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+FAIL:\s*(.*)/);
  if (failMatch) return { stepNumber: parseInt(failMatch[1]), status: 'fail', message: failMatch[3] };

  const skipMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\s+—\s+SKIPPED/);
  if (skipMatch) return { stepNumber: parseInt(skipMatch[1]), status: 'skipped', message: 'Skipped' };

  const progMatch = line.match(/\[(\d+)\/\d+\]\s+(.+?)\.{3}/);
  if (progMatch) return { stepNumber: parseInt(progMatch[1]), status: 'in_progress', message: progMatch[2].trim() };

  return null;
}

function startLocalTx(durationSeconds: number): { process: ChildProcess; kill: () => void } {
  const configPath = getSdrAssetPath('config.py');
  const txPath = getSdrAssetPath('tx_tone.py');
  const dir = join(txPath, '..');

  log('Starting local TX transmitter for %ds from %s', durationSeconds, dir);

  const proc = spawn('python3', [txPath], {
    cwd: dir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d: Buffer) => log('[TX stdout] %s', d.toString().trim()));
  proc.stderr?.on('data', (d: Buffer) => log('[TX stderr] %s', d.toString().trim()));
  proc.on('error', (err) => log('[TX error] %s', err.message));

  // Auto-kill after duration + buffer
  const timer = setTimeout(() => {
    log('TX duration elapsed, sending SIGINT');
    proc.kill('SIGINT');
  }, (durationSeconds + 1) * 1000);

  return {
    process: proc,
    kill: () => {
      clearTimeout(timer);
      if (!proc.killed) {
        proc.kill('SIGINT');
        // Force kill after 3s
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 3000);
      }
    },
  };
}

export async function runSdrTest(
  serialNumber: string,
  settings: Settings,
  emit: EmitFn
): Promise<SdrTestResult> {
  let conn;
  let txHandle: { process: ChildProcess; kill: () => void } | null = null;

  log('Starting SDR test for T3S-%s (host: %s)', serialNumber, settings.deviceIp);

  try {
    // === PREP: Check desktop SDR ===
    emit('prep_step', { stepId: 'check_desktop_sdr', status: 'in_progress', message: 'Checking desktop SDR...' });
    try {
      getSdrAssetPath('tx_tone.py');
      getSdrAssetPath('config.py');
      log('TX scripts found');
      emit('prep_step', { stepId: 'check_desktop_sdr', status: 'pass', message: 'Desktop SDR scripts ready' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      emit('prep_step', { stepId: 'check_desktop_sdr', status: 'fail', message: msg });
      throw new Error(msg);
    }

    // === PREP: Upload test scripts to Pi ===
    emit('prep_step', { stepId: 'upload_test_scripts', status: 'in_progress', message: 'Connecting to device...' });

    conn = await connectSSH({
      host: settings.deviceIp,
      username: settings.sshUsername,
      password: settings.sshPassword,
      timeout: 10000,
    });
    log('SSH connected');

    // Create directory and upload scripts
    await conn.exec('mkdir -p /tmp/sdr');

    const configPy = getSdrAsset('config.py');
    const rxTonePy = getSdrAsset('rx_tone.py');
    const testSh = getSdrAsset('test.sh');

    await conn.uploadFile(configPy, '/tmp/sdr/config.py');
    await conn.uploadFile(rxTonePy, '/tmp/sdr/rx_tone.py');
    await conn.uploadFile(testSh, '/tmp/sdr/test.sh');

    log('Uploaded SDR test scripts to Pi');
    emit('prep_step', { stepId: 'upload_test_scripts', status: 'pass', message: 'Test scripts uploaded' });

    // === PREP: Start desktop transmitter ===
    emit('prep_step', { stepId: 'start_transmitter', status: 'in_progress', message: 'Starting desktop transmitter...' });

    const captureDuration = 5; // seconds
    txHandle = startLocalTx(captureDuration);

    // Wait for TX to initialize
    await new Promise(resolve => setTimeout(resolve, 1500));
    log('TX transmitter started, waiting 1.5s for init');
    emit('prep_step', { stepId: 'start_transmitter', status: 'pass', message: 'Transmitter active' });

    // === RUN: Execute test.sh on Pi ===
    log('Running test.sh on Pi...');

    const command = `bash /tmp/sdr/test.sh --duration ${captureDuration} --json 2>&1`;

    let finalJson: SdrTestResult | null = null;
    let jsonBuffer = '';
    let collectingJson = false;
    let allOutput = '';
    const stepTimers = new Map<number, number>();

    const fixJson = (str: string): string => str.replace(/:(\.\d)/g, ':0$1');

    const tryParseJson = (str: string): SdrTestResult | null => {
      try {
        const parsed = JSON.parse(fixJson(str));
        if (parsed && typeof parsed === 'object' && 'operation' in parsed) {
          return parsed as SdrTestResult;
        }
      } catch { /* not valid JSON */ }
      return null;
    };

    const processData = (data: string) => {
      allOutput += data;

      if (collectingJson) {
        jsonBuffer += data;
        const parsed = tryParseJson(jsonBuffer);
        if (parsed) {
          finalJson = parsed;
          collectingJson = false;
          log('Received test JSON result: %s', finalJson.result);
          return;
        }
        const lastBrace = jsonBuffer.lastIndexOf('}');
        if (lastBrace > 0) {
          const parsed2 = tryParseJson(jsonBuffer.slice(0, lastBrace + 1));
          if (parsed2) {
            finalJson = parsed2;
            collectingJson = false;
            log('Received test JSON result (trimmed): %s', finalJson.result);
            return;
          }
        }
        return;
      }

      for (const rawLine of data.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        if (trimmed.includes('{') && trimmed.includes('"operation"')) {
          const jsonStart = trimmed.indexOf('{');
          const candidate = trimmed.slice(jsonStart);
          const parsed = tryParseJson(candidate);
          if (parsed) {
            finalJson = parsed;
            log('Received test JSON result: %s', finalJson.result);
            continue;
          } else {
            collectingJson = true;
            jsonBuffer = candidate;
            continue;
          }
        }

        const update = parseProgressLine(trimmed);
        if (update) {
          log('Step %d: %s — %s', update.stepNumber, update.message, update.status);
          if (update.status === 'in_progress') {
            stepTimers.set(update.stepNumber, Date.now());
          } else if (update.status === 'pass' || update.status === 'fail') {
            const startTime = stepTimers.get(update.stepNumber);
            if (startTime) update.duration = (Date.now() - startTime) / 1000;
          }
          emit('step_update', update);
        } else {
          log('SSH output: %s', trimmed);
        }
      }
    };

    const timeoutMs = 60 * 1000; // 1 minute for SDR test
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('SDR test timed out after 60 seconds')), timeoutMs);
    });

    const testPromise = conn.execStream(
      command,
      (data: string) => processData(data),
      (data: string) => processData(data)
    );

    const exitCode = await Promise.race([testPromise, timeoutPromise]);
    log('test.sh exited with code: %d', exitCode);

    // Stop TX
    txHandle.kill();
    txHandle = null;

    // Fallback JSON extraction
    if (!finalJson) {
      for (const line of allOutput.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('"operation"')) {
          const parsed = tryParseJson(trimmed);
          if (parsed) { finalJson = parsed; break; }
        }
      }
    }

    if (finalJson) {
      emit('test_complete', finalJson);
      return finalJson;
    }

    log('No JSON result from test.sh');
    const result: SdrTestResult = {
      operation: 'sdr_test',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      result: 'fail',
      steps: [],
    };
    emit('test_complete', result);
    return result;

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log('SDR test failed: %s', message);

    let errorMsg = message;
    if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('Timed out')) {
      errorMsg = `Cannot reach device at ${settings.deviceIp} — check Ethernet cable`;
    } else if (message.includes('Authentication')) {
      errorMsg = 'Authentication failed — check credentials in Settings';
    }

    emit('test_error', { error: errorMsg });
    throw new Error(errorMsg);
  } finally {
    txHandle?.kill();
    conn?.close();
    log('Cleanup complete');
  }
}
