import { connectSSH, connectViaProxy } from './ssh';
import { Settings, StepUpdateEvent, InstallResult, PrepStepEvent } from './types';
import { prepareDockerBinaries, prepareFirmwareImage, getCachePaths } from './offline-assets';
import { readFileSync, statSync, createReadStream } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

type EmitFn = (event: string, data: StepUpdateEvent | InstallResult | PrepStepEvent | { error: string }) => void;

function log(msg: string, ...args: unknown[]) {
  console.log(`[installer] ${msg}`, ...args);
}

function logError(msg: string, ...args: unknown[]) {
  console.error(`[installer] ${msg}`, ...args);
}

function getInstallScript(): string {
  const paths = [
    join(process.cwd(), 'src', 'assets', 'install.sh'),
    join(process.cwd(), 'assets', 'install.sh'),
  ];
  for (const p of paths) {
    try {
      const content = readFileSync(p, 'utf-8');
      log('Loaded install.sh from %s (%d bytes)', p, content.length);
      return content;
    } catch { /* try next */ }
  }
  throw new Error('install.sh not found in any expected location');
}

// Parse progress lines: [N/12] label... / PASS / FAIL / SKIPPED
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

// Upload a large file via SFTP with progress logging
async function uploadLargeFile(
  conn: Awaited<ReturnType<typeof connectSSH>>,
  localPath: string,
  remotePath: string,
  label: string,
  emit: EmitFn,
  prepStepId: string
): Promise<void> {
  const size = statSync(localPath).size;
  const sizeMB = Math.round(size / 1024 / 1024);
  log('Uploading %s: %s → %s (%dMB)', label, localPath, remotePath, sizeMB);
  emit('prep_step', { stepId: prepStepId, status: 'in_progress', message: `Uploading ${label} (${sizeMB}MB)...` });

  return new Promise((resolve, reject) => {
    conn.client.sftp((err, sftp) => {
      if (err) return reject(new Error(`SFTP init failed: ${err.message}`));

      const readStream = createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);

      let transferred = 0;
      let lastLoggedPct = -10;

      readStream.on('data', (chunk: string | Buffer) => {
        transferred += chunk.length;
        const pct = Math.round((transferred / size) * 100);
        if (pct - lastLoggedPct >= 10) {
          lastLoggedPct = pct;
          log('  %s: %d%%', label, pct);
          emit('prep_step', {
            stepId: prepStepId,
            status: 'in_progress',
            message: `Uploading ${label} (${pct}%)...`,
          });
        }
      });

      writeStream.on('close', () => {
        sftp.end();
        log('Upload complete: %s', label);
        emit('prep_step', { stepId: prepStepId, status: 'pass', message: `${label} uploaded (${sizeMB}MB)` });
        resolve();
      });

      writeStream.on('error', (e: Error) => {
        sftp.end();
        reject(new Error(`Upload failed for ${label}: ${e.message}`));
      });

      readStream.pipe(writeStream);
    });
  });
}

// Upload a directory by tarring on desktop and untarring on Pi
async function uploadDirectory(
  conn: Awaited<ReturnType<typeof connectSSH>>,
  localDir: string,
  remoteDir: string,
  label: string,
  emit: EmitFn,
  prepStepId: string
): Promise<void> {
  log('Uploading directory %s: %s → %s', label, localDir, remoteDir);
  emit('prep_step', { stepId: prepStepId, status: 'in_progress', message: `Uploading ${label}...` });

  // Create a tar on the desktop, upload it, extract on Pi
  const tarPath = join(getCachePaths().cacheDir, 'docker-upload.tar.gz');
  try {
    execSync(`tar czf "${tarPath}" -C "${localDir}" .`, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to create tar: ${err instanceof Error ? err.message : err}`);
  }

  const size = statSync(tarPath).size;
  const sizeMB = Math.round(size / 1024 / 1024);

  // Upload tar
  await uploadLargeFile(conn, tarPath, '/tmp/docker-static.tar.gz', label, emit, prepStepId);

  // Extract on Pi
  log('Extracting %s on Pi...', label);
  const result = await conn.exec(`sudo mkdir -p ${remoteDir} && sudo tar xzf /tmp/docker-static.tar.gz -C ${remoteDir} && sudo rm /tmp/docker-static.tar.gz`);
  if (result.code !== 0) {
    throw new Error(`Failed to extract ${label} on Pi: ${result.stderr}`);
  }

  emit('prep_step', { stepId: prepStepId, status: 'pass', message: `${label} uploaded (${sizeMB}MB)` });
}

export async function runInstall(
  serialNumber: string,
  settings: Settings,
  emit: EmitFn,
  abortSignal?: AbortSignal
): Promise<InstallResult> {
  const hostname = `T3S-${serialNumber}`;
  let conn: Awaited<ReturnType<typeof connectSSH>> | null = null;
  let closeAll: (() => void) | null = null;
  const useProxy = !!settings.desktopIp;

  log('Starting offline install for %s (host: %s, via: %s)', hostname, settings.deviceIp, useProxy ? settings.desktopIp : 'direct');

  const paths = getCachePaths();

  try {
    // === PHASE 1: Prepare offline assets on desktop ===
    log('=== Phase 1: Preparing offline assets ===');

    emit('prep_step', { stepId: 'prepare_docker', status: 'in_progress', message: 'Checking Docker binaries cache...' });
    await prepareDockerBinaries((msg) => {
      emit('prep_step', { stepId: 'prepare_docker', status: 'in_progress', message: msg });
    });
    emit('prep_step', { stepId: 'prepare_docker', status: 'pass', message: 'Docker binaries ready' });

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    emit('prep_step', { stepId: 'prepare_firmware', status: 'in_progress', message: 'Checking firmware image cache...' });
    await prepareFirmwareImage(settings.firmwareImage, settings.ghcrUsername, settings.ghcrToken, (msg) => {
      emit('prep_step', { stepId: 'prepare_firmware', status: 'in_progress', message: msg });
    });
    emit('prep_step', { stepId: 'prepare_firmware', status: 'pass', message: 'Firmware image ready' });

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    // === PHASE 2: Connect and upload to Pi ===
    log('=== Phase 2: Uploading files to Pi ===');

    let desktopConn: Awaited<ReturnType<typeof connectSSH>> | null = null;

    if (useProxy) {
      // Connect to desktop first
      log('Connecting to desktop %s...', settings.desktopIp);
      desktopConn = await connectSSH({
        host: settings.desktopIp,
        username: settings.desktopSshUsername,
        password: settings.desktopSshPassword,
        timeout: 10000,
      });
      log('Desktop connected');

      // Cache firmware.tar on desktop (server → desktop over WiFi, once)
      // Then desktop → Pi is fast Ethernet for every subsequent device
      const desktopCacheDir = '/tmp/t3s-cache';
      const desktopFirmwarePath = `${desktopCacheDir}/firmware.tar`;
      await desktopConn.exec(`mkdir -p ${desktopCacheDir}`);

      const desktopCacheCheck = await desktopConn.exec(`[ -f ${desktopFirmwarePath} ] && stat -c%s ${desktopFirmwarePath} 2>/dev/null || echo 0`);
      const desktopCacheSize = parseInt(desktopCacheCheck.stdout.trim()) || 0;
      const localSize = statSync(paths.firmwareTar).size;

      if (desktopCacheSize === localSize) {
        log('Firmware already cached on desktop (%dMB)', Math.round(localSize / 1024 / 1024));
        emit('prep_step', { stepId: 'upload_firmware', status: 'pass', message: `Firmware cached on desktop (${Math.round(localSize / 1024 / 1024)}MB)` });
      } else {
        log('Uploading firmware to desktop cache (server → desktop WiFi)...');
        emit('prep_step', { stepId: 'upload_firmware', status: 'in_progress', message: 'Caching firmware on desktop (first time)...' });
        await uploadLargeFile(desktopConn, paths.firmwareTar, desktopFirmwarePath, 'Firmware to desktop', emit, 'upload_firmware');
      }

      // Connect to Pi via ProxyJump
      log('Connecting via ProxyJump: server → %s → %s', settings.desktopIp, settings.deviceIp);
      const proxy = await connectViaProxy({
        jumpHost: settings.desktopIp,
        jumpUsername: settings.desktopSshUsername,
        jumpPassword: settings.desktopSshPassword,
        targetHost: settings.deviceIp,
        targetUsername: settings.sshUsername,
        targetPassword: settings.sshPassword,
        timeout: 10000,
      });
      conn = proxy.target;
      closeAll = proxy.closeAll;
      log('SSH connected to Pi via %s', settings.desktopIp);

      // Upload install script to Pi (small, via tunnel is fine)
      emit('prep_step', { stepId: 'upload_script', status: 'in_progress', message: 'Uploading install script...' });
      const script = getInstallScript();
      await conn.uploadFile(script, '/tmp/install.sh');
      log('Uploaded install.sh to Pi');
      emit('prep_step', { stepId: 'upload_script', status: 'pass', message: 'Install script uploaded' });

      if (abortSignal?.aborted) throw new Error('Installation aborted');

      // Upload Docker binaries — skip if already on Pi
      const dockerCheck = await conn.exec('command -v docker 2>/dev/null && docker --version 2>/dev/null');
      if (dockerCheck.code === 0 && dockerCheck.stdout.includes('Docker')) {
        log('Docker already on Pi, skipping');
        emit('prep_step', { stepId: 'upload_docker', status: 'pass', message: 'Docker already installed on device' });
      } else {
        await uploadDirectory(conn, paths.dockerDir, '/tmp/docker-static', 'Docker binaries', emit, 'upload_docker');
      }

      if (abortSignal?.aborted) throw new Error('Installation aborted');

      // Copy firmware from desktop cache to Pi (fast Ethernet, desktop → Pi)
      log('Copying firmware from desktop cache to Pi (fast Ethernet)...');
      emit('prep_step', { stepId: 'upload_firmware', status: 'in_progress', message: 'Transferring firmware to device (Ethernet)...' });
      const scpResult = await desktopConn.exec(
        `sshpass -p '${settings.sshPassword}' scp -o StrictHostKeyChecking=no ${desktopFirmwarePath} ${settings.sshUsername}@${settings.deviceIp}:/tmp/firmware.tar 2>&1`
      );
      if (scpResult.code !== 0) {
        // Fallback: check if sshpass is available, if not try expect or direct
        log('scp via desktop failed (%s), falling back to tunnel upload', scpResult.stderr.trim());
        await uploadLargeFile(conn, paths.firmwareTar, '/tmp/firmware.tar', 'Firmware image', emit, 'upload_firmware');
      } else {
        log('Firmware copied from desktop to Pi via Ethernet');
        emit('prep_step', { stepId: 'upload_firmware', status: 'pass', message: 'Firmware transferred via Ethernet' });
      }
    } else {
      // Direct mode — no desktop proxy
      log('Connecting directly to %s@%s...', settings.sshUsername, settings.deviceIp);
      conn = await connectSSH({
        host: settings.deviceIp,
        username: settings.sshUsername,
        password: settings.sshPassword,
        timeout: 10000,
      });
      log('SSH connected');

      // Upload install script
      emit('prep_step', { stepId: 'upload_script', status: 'in_progress', message: 'Uploading install script...' });
      const script = getInstallScript();
      await conn.uploadFile(script, '/tmp/install.sh');
      log('Uploaded install.sh');
      emit('prep_step', { stepId: 'upload_script', status: 'pass', message: 'Install script uploaded' });

      if (abortSignal?.aborted) throw new Error('Installation aborted');

      // Upload Docker binaries — skip if already on Pi
      const dockerCheck = await conn.exec('command -v docker 2>/dev/null && docker --version 2>/dev/null');
      if (dockerCheck.code === 0 && dockerCheck.stdout.includes('Docker')) {
        log('Docker already on Pi, skipping');
        emit('prep_step', { stepId: 'upload_docker', status: 'pass', message: 'Docker already installed on device' });
      } else {
        await uploadDirectory(conn, paths.dockerDir, '/tmp/docker-static', 'Docker binaries', emit, 'upload_docker');
      }

      if (abortSignal?.aborted) throw new Error('Installation aborted');

      // Upload firmware tar directly
      await uploadLargeFile(conn, paths.firmwareTar, '/tmp/firmware.tar', 'Firmware image', emit, 'upload_firmware');
    }

    if (abortSignal?.aborted) throw new Error('Installation aborted');

    // === PHASE 3: Run install script in offline mode ===
    log('=== Phase 3: Running install script ===');

    const command = `sudo bash /tmp/install.sh --image-tar /tmp/firmware.tar --hostname ${hostname} --json 2>&1`;
    log('Executing: %s', command.replace(/\/tmp\/firmware\.tar/, '/tmp/firmware.tar'));

    let finalJson: InstallResult | null = null;
    let jsonBuffer = '';
    let collectingJson = false;
    const stepTimers = new Map<number, number>();
    let allOutput = '';

    const timeoutMs = 15 * 60 * 1000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Installation timed out after 15 minutes')), timeoutMs);
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Installation aborted'));
        });
      }
    });

    const fixJson = (str: string): string => str.replace(/:(\.\d)/g, ':0$1');

    const tryParseJson = (str: string): InstallResult | null => {
      try {
        const parsed = JSON.parse(fixJson(str));
        if (parsed && typeof parsed === 'object' && 'operation' in parsed) {
          return parsed as InstallResult;
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
          log('Received final JSON result (multi-chunk): %s', finalJson.result);
          return;
        }
        const lastBrace = jsonBuffer.lastIndexOf('}');
        if (lastBrace > 0) {
          const candidate = jsonBuffer.slice(0, lastBrace + 1);
          const parsed2 = tryParseJson(candidate);
          if (parsed2) {
            finalJson = parsed2;
            collectingJson = false;
            log('Received final JSON result (trimmed): %s', finalJson.result);
            return;
          }
        }
        return;
      }

      const lines = data.split('\n');
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        if (trimmed.includes('{') && trimmed.includes('"operation"')) {
          const jsonStart = trimmed.indexOf('{');
          const candidate = trimmed.slice(jsonStart);
          const parsed = tryParseJson(candidate);
          if (parsed) {
            finalJson = parsed;
            log('Received final JSON result: %s', finalJson.result);
            continue;
          } else {
            collectingJson = true;
            jsonBuffer = candidate;
            log('JSON started (%d chars), collecting...', candidate.length);
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

    // Fallback JSON extraction
    if (!finalJson) {
      log('JSON not found during streaming, scanning full output...');
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
    if (closeAll) {
      closeAll();
    } else {
      conn?.close();
    }
    log('SSH connection closed');
  }
}
