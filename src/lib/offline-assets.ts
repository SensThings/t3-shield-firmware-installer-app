import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { CacheStatus } from './types';

const DOCKER_STATIC_URL = 'https://download.docker.com/linux/static/stable/aarch64/docker-27.5.1.tgz';
const CACHE_DIR = join(process.env.HOME || '/tmp', '.t3shield-installer');

function log(msg: string, ...args: unknown[]) {
  console.log(`[offline-assets] ${msg}`, ...args);
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    log('Created cache directory: %s', CACHE_DIR);
  }
}

export function getCachePaths() {
  return {
    cacheDir: CACHE_DIR,
    dockerTgz: join(CACHE_DIR, 'docker-static.tgz'),
    dockerDir: join(CACHE_DIR, 'docker-static'),
    firmwareTar: join(CACHE_DIR, 'firmware.tar'),
    firmwareVersion: join(CACHE_DIR, 'firmware-version.txt'),
    firmwareDigest: join(CACHE_DIR, 'firmware-digest.txt'),
  };
}

export function getCacheStatus(): CacheStatus {
  const paths = getCachePaths();
  const dockerReady = existsSync(join(paths.dockerDir, 'docker', 'dockerd'));
  const firmwareReady = existsSync(paths.firmwareTar);
  let firmwareTag: string | null = null;
  if (existsSync(paths.firmwareVersion)) {
    firmwareTag = readFileSync(paths.firmwareVersion, 'utf-8').trim();
  }
  return { dockerBinaries: dockerReady, firmwareImage: firmwareReady, firmwareTag };
}

export async function prepareDockerBinaries(
  onProgress?: (msg: string) => void
): Promise<string> {
  ensureCacheDir();
  const paths = getCachePaths();

  if (existsSync(join(paths.dockerDir, 'docker', 'dockerd'))) {
    log('Docker binaries already cached');
    onProgress?.('Docker binaries cached');
    return paths.dockerDir;
  }

  if (!existsSync(paths.dockerTgz)) {
    log('Downloading Docker static binaries from %s', DOCKER_STATIC_URL);
    onProgress?.('Downloading Docker binaries (60MB)...');
    try {
      execSync(`curl -fSL -o "${paths.dockerTgz}" "${DOCKER_STATIC_URL}"`, {
        stdio: 'pipe',
        timeout: 5 * 60 * 1000,
      });
      const size = statSync(paths.dockerTgz).size;
      log('Downloaded Docker binaries: %dMB', Math.round(size / 1024 / 1024));
    } catch (err) {
      throw new Error(`Failed to download Docker binaries: ${err instanceof Error ? err.message : err}`);
    }
  }

  log('Extracting Docker binaries...');
  onProgress?.('Extracting Docker binaries...');
  mkdirSync(paths.dockerDir, { recursive: true });
  try {
    execSync(`tar xzf "${paths.dockerTgz}" -C "${paths.dockerDir}"`, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to extract Docker binaries: ${err instanceof Error ? err.message : err}`);
  }

  if (!existsSync(join(paths.dockerDir, 'docker', 'dockerd'))) {
    throw new Error('Docker binaries extraction failed — dockerd not found');
  }

  log('Docker binaries ready at %s', paths.dockerDir);
  onProgress?.('Docker binaries ready');
  return paths.dockerDir;
}

/**
 * Get the remote digest for an image without pulling it.
 * Uses `docker manifest inspect` which only fetches metadata.
 */
function getRemoteDigest(image: string): string | null {
  try {
    const output = execSync(
      `docker manifest inspect "${image}" 2>/dev/null | grep -o '"digest":"[^"]*"' | head -1 | cut -d'"' -f4`,
      { stdio: 'pipe', timeout: 30000 }
    ).toString().trim();
    return output || null;
  } catch {
    return null;
  }
}

export async function prepareFirmwareImage(
  image: string,
  ghcrUsername: string,
  ghcrToken: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  ensureCacheDir();
  const paths = getCachePaths();

  // Check docker is available
  try {
    execSync('docker --version', { stdio: 'pipe' });
  } catch {
    throw new Error('Docker is not installed on this machine. Install Docker and try again.');
  }

  // Login to GHCR (needed for digest check + pull)
  log('Logging in to ghcr.io...');
  onProgress?.('Logging in to container registry...');
  try {
    execSync(`echo "${ghcrToken}" | docker login ghcr.io -u "${ghcrUsername}" --password-stdin`, {
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch {
    throw new Error('GHCR login failed — check username and token in Settings');
  }

  // Check if cache is up to date by comparing digests
  if (existsSync(paths.firmwareTar) && existsSync(paths.firmwareDigest)) {
    const cachedDigest = readFileSync(paths.firmwareDigest, 'utf-8').trim();
    onProgress?.('Checking for firmware updates...');
    const remoteDigest = getRemoteDigest(image);

    if (remoteDigest && cachedDigest === remoteDigest) {
      const size = statSync(paths.firmwareTar).size;
      log('Firmware cache is up to date: %s (%dMB)', remoteDigest, Math.round(size / 1024 / 1024));
      onProgress?.(`Firmware image up to date (${Math.round(size / 1024 / 1024)}MB)`);
      return paths.firmwareTar;
    }

    if (remoteDigest) {
      log('Firmware update available: cached=%s, remote=%s', cachedDigest, remoteDigest);
      onProgress?.('New firmware version available, pulling...');
    } else {
      log('Could not check remote digest, using cache');
      const size = statSync(paths.firmwareTar).size;
      onProgress?.(`Using cached firmware (${Math.round(size / 1024 / 1024)}MB)`);
      return paths.firmwareTar;
    }
  }

  // Pull image for ARM64
  log('Pulling firmware image: %s', image);
  onProgress?.('Pulling firmware image (this may take a few minutes)...');
  try {
    execSync(`docker pull --platform linux/arm64 "${image}"`, {
      stdio: 'pipe',
      timeout: 10 * 60 * 1000,
    });
  } catch {
    throw new Error('Failed to pull firmware image. Check that the image exists and GHCR credentials are correct.');
  }

  // Get the digest of what we just pulled
  const digest = getRemoteDigest(image);

  // Save to tar
  log('Saving firmware image to tar...');
  onProgress?.('Saving firmware image to disk...');
  try {
    execSync(`docker save "${image}" -o "${paths.firmwareTar}"`, {
      stdio: 'pipe',
      timeout: 5 * 60 * 1000,
    });
  } catch {
    throw new Error('Failed to save firmware image to disk');
  }

  // Write version tag + digest
  writeFileSync(paths.firmwareVersion, image);
  if (digest) {
    writeFileSync(paths.firmwareDigest, digest);
  }

  const size = statSync(paths.firmwareTar).size;
  log('Firmware image saved: %dMB (digest: %s)', Math.round(size / 1024 / 1024), digest || 'unknown');
  onProgress?.(`Firmware image ready (${Math.round(size / 1024 / 1024)}MB)`);
  return paths.firmwareTar;
}

export function clearFirmwareCache(): void {
  const paths = getCachePaths();
  try {
    execSync(`rm -f "${paths.firmwareTar}" "${paths.firmwareVersion}" "${paths.firmwareDigest}"`);
    log('Firmware cache cleared');
  } catch {
    // ignore
  }
}
