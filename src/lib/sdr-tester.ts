import { connectSSH, connectViaProxy, type SSHConnection } from './ssh';
import { Settings, StepUpdateEvent, PrepStepEvent } from './types';
import { readFileSync } from 'fs';
import { join } from 'path';

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

export async function runSdrTest(
  serialNumber: string,
  settings: Settings,
  emit: EmitFn
): Promise<SdrTestResult> {
  let desktopConn: SSHConnection | null = null;
  let piConn: SSHConnection | null = null;
  let closeAll: (() => void) | null = null;
  const useProxy = !!settings.desktopIp;

  log('Starting SDR test for T3S-%s (desktop: %s, device: %s)', serialNumber, settings.desktopIp || 'direct', settings.deviceIp);

  try {
    // === PREP: Connect to desktop and upload TX scripts ===
    emit('prep_step', { stepId: 'check_desktop_sdr', status: 'in_progress', message: 'Connecting to desktop...' });

    if (!settings.desktopIp) {
      emit('prep_step', { stepId: 'check_desktop_sdr', status: 'fail', message: 'Desktop IP not configured in Settings' });
      throw new Error('Desktop IP is required for SDR test — configure it in Settings');
    }

    desktopConn = await connectSSH({
      host: settings.desktopIp,
      username: settings.desktopSshUsername,
      password: settings.desktopSshPassword,
      timeout: 10000,
    });
    log('Connected to desktop %s', settings.desktopIp);

    // Upload TX scripts to desktop
    await desktopConn.exec('mkdir -p /tmp/sdr');
    await desktopConn.uploadFile(getSdrAsset('config.py'), '/tmp/sdr/config.py');
    await desktopConn.uploadFile(getSdrAsset('tx_tone.py'), '/tmp/sdr/tx_tone.py');
    log('Uploaded TX scripts to desktop');

    // Verify B210 on desktop (SSH non-interactive may not have UHD in PATH)
    const sdrCheck = await desktopConn.exec(
      'export PATH="$PATH:/usr/local/bin:/usr/bin:/opt/uhd/bin" && uhd_find_devices 2>/dev/null | grep -c "type: b200" || echo 0'
    );
    const sdrCount = parseInt(sdrCheck.stdout.trim()) || 0;
    if (sdrCount < 1) {
      // Log what we see for debugging
      const whichUhd = await desktopConn.exec('which uhd_find_devices 2>&1 || echo "not found"; echo "PATH=$PATH"');
      log('SDR check failed. uhd: %s', whichUhd.stdout.trim());
      emit('prep_step', { stepId: 'check_desktop_sdr', status: 'fail', message: 'No B210 SDR detected on desktop — check USB connection' });
      throw new Error('No B210 SDR detected on desktop');
    }

    emit('prep_step', { stepId: 'check_desktop_sdr', status: 'pass', message: 'Desktop SDR ready' });

    // === PREP: Connect to Pi (via desktop proxy) and upload RX scripts ===
    emit('prep_step', { stepId: 'upload_test_scripts', status: 'in_progress', message: 'Connecting to device via desktop...' });

    if (useProxy) {
      const proxy = await connectViaProxy({
        jumpHost: settings.desktopIp,
        jumpUsername: settings.desktopSshUsername,
        jumpPassword: settings.desktopSshPassword,
        targetHost: settings.deviceIp,
        targetUsername: settings.sshUsername,
        targetPassword: settings.sshPassword,
        timeout: 10000,
      });
      piConn = proxy.target;
      closeAll = proxy.closeAll;
    } else {
      piConn = await connectSSH({
        host: settings.deviceIp,
        username: settings.sshUsername,
        password: settings.sshPassword,
        timeout: 10000,
      });
    }
    log('Connected to Pi');

    await piConn.exec('mkdir -p /tmp/sdr');
    await piConn.uploadFile(getSdrAsset('config.py'), '/tmp/sdr/config.py');
    await piConn.uploadFile(getSdrAsset('rx_tone.py'), '/tmp/sdr/rx_tone.py');
    await piConn.uploadFile(getSdrAsset('test.sh'), '/tmp/sdr/test.sh');
    log('Uploaded RX scripts to Pi');

    emit('prep_step', { stepId: 'upload_test_scripts', status: 'pass', message: 'Test scripts uploaded to device' });

    // === PREP: Start TX on desktop via SSH ===
    emit('prep_step', { stepId: 'start_transmitter', status: 'in_progress', message: 'Starting transmitter on desktop...' });

    const captureDuration = 5;

    // Start TX in background on desktop — it runs until killed
    await desktopConn.exec(`cd /tmp/sdr && export PATH="$PATH:/usr/local/bin:/usr/bin" && nohup python3 tx_tone.py > /tmp/sdr/tx.log 2>&1 & echo $!`);
    log('TX started on desktop via SSH');

    // Wait for TX to initialize
    await new Promise(resolve => setTimeout(resolve, 1500));
    emit('prep_step', { stepId: 'start_transmitter', status: 'pass', message: 'Transmitter active on desktop' });

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

    const testPromise = piConn.execStream(
      command,
      (data: string) => processData(data),
      (data: string) => processData(data)
    );

    const exitCode = await Promise.race([testPromise, timeoutPromise]);
    log('test.sh exited with code: %d', exitCode);

    // Stop TX on desktop
    if (desktopConn) {
      await desktopConn.exec('pkill -f tx_tone.py 2>/dev/null || true');
      log('TX stopped on desktop');
    }

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
    // Always kill TX on desktop
    if (desktopConn) {
      try { await desktopConn.exec('pkill -f tx_tone.py 2>/dev/null || true'); } catch { /* ignore */ }
    }
    if (closeAll) {
      closeAll();
    } else {
      piConn?.close();
      desktopConn?.close();
    }
    log('Cleanup complete');
  }
}
