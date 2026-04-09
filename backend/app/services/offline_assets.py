import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)

DOCKER_STATIC_URL = "https://download.docker.com/linux/static/stable/aarch64/docker-27.5.1.tgz"
CACHE_DIR = os.path.join(os.path.expanduser("~"), ".t3shield-installer")


def ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


def get_cache_paths() -> dict:
    return {
        "cache_dir": CACHE_DIR,
        "docker_tgz": os.path.join(CACHE_DIR, "docker-static.tgz"),
        "docker_dir": os.path.join(CACHE_DIR, "docker-static"),
        "firmware_tar": os.path.join(CACHE_DIR, "firmware.tar"),
        "firmware_version": os.path.join(CACHE_DIR, "firmware-version.txt"),
        "firmware_digest": os.path.join(CACHE_DIR, "firmware-digest.txt"),
    }


def get_cache_status() -> dict:
    paths = get_cache_paths()
    docker_ready = os.path.exists(os.path.join(paths["docker_dir"], "docker", "dockerd"))
    firmware_ready = os.path.exists(paths["firmware_tar"])
    firmware_tag = None
    if os.path.exists(paths["firmware_version"]):
        firmware_tag = open(paths["firmware_version"]).read().strip()
    return {"docker_binaries": docker_ready, "firmware_image": firmware_ready, "firmware_tag": firmware_tag}


def prepare_docker_binaries(on_progress=None) -> str:
    ensure_cache_dir()
    paths = get_cache_paths()

    dockerd = os.path.join(paths["docker_dir"], "docker", "dockerd")
    if os.path.exists(dockerd):
        logger.info("Docker binaries already cached")
        if on_progress:
            on_progress("Docker binaries cached")
        return paths["docker_dir"]

    if not os.path.exists(paths["docker_tgz"]):
        logger.info("Downloading Docker static binaries")
        if on_progress:
            on_progress("Downloading Docker binaries (60MB)...")
        subprocess.run(
            ["curl", "-fSL", "-o", paths["docker_tgz"], DOCKER_STATIC_URL],
            check=True, capture_output=True, timeout=300,
        )
        size_mb = os.path.getsize(paths["docker_tgz"]) // (1024 * 1024)
        logger.info("Downloaded: %dMB", size_mb)

    logger.info("Extracting Docker binaries")
    if on_progress:
        on_progress("Extracting Docker binaries...")
    os.makedirs(paths["docker_dir"], exist_ok=True)
    subprocess.run(
        ["tar", "xzf", paths["docker_tgz"], "-C", paths["docker_dir"]],
        check=True, capture_output=True,
    )

    if not os.path.exists(dockerd):
        raise RuntimeError("Docker extraction failed — dockerd not found")

    if on_progress:
        on_progress("Docker binaries ready")
    return paths["docker_dir"]


def _get_remote_digest(image: str) -> str | None:
    try:
        result = subprocess.run(
            ["docker", "manifest", "inspect", image],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            import json
            manifest = json.loads(result.stdout)
            return manifest.get("digest", "")
    except Exception:
        pass
    return None


def prepare_firmware_image(image: str, ghcr_username: str, ghcr_token: str, on_progress=None) -> str:
    ensure_cache_dir()
    paths = get_cache_paths()

    # Check docker is available
    if shutil.which("docker") is None:
        raise RuntimeError("Docker is not installed on this machine.")

    # Login to GHCR
    logger.info("Logging in to ghcr.io")
    if on_progress:
        on_progress("Logging in to container registry...")
    try:
        subprocess.run(
            f'echo "{ghcr_token}" | docker login ghcr.io -u "{ghcr_username}" --password-stdin',
            shell=True, check=True, capture_output=True, timeout=30,
        )
    except subprocess.CalledProcessError:
        raise RuntimeError("GHCR login failed — check username and token in Settings")

    # Check cache by digest
    if os.path.exists(paths["firmware_tar"]) and os.path.exists(paths["firmware_digest"]):
        cached_digest = open(paths["firmware_digest"]).read().strip()
        if on_progress:
            on_progress("Checking for firmware updates...")
        remote_digest = _get_remote_digest(image)
        if remote_digest and cached_digest == remote_digest:
            size_mb = os.path.getsize(paths["firmware_tar"]) // (1024 * 1024)
            logger.info("Firmware cache up to date (%dMB)", size_mb)
            if on_progress:
                on_progress(f"Firmware image up to date ({size_mb}MB)")
            return paths["firmware_tar"]
        if remote_digest:
            logger.info("New firmware available: cached=%s remote=%s", cached_digest, remote_digest)
        elif not remote_digest:
            size_mb = os.path.getsize(paths["firmware_tar"]) // (1024 * 1024)
            if on_progress:
                on_progress(f"Using cached firmware ({size_mb}MB)")
            return paths["firmware_tar"]

    # Pull
    logger.info("Pulling firmware image: %s", image)
    if on_progress:
        on_progress("Pulling firmware image...")
    try:
        subprocess.run(
            ["docker", "pull", "--platform", "linux/arm64", image],
            check=True, capture_output=True, timeout=600,
        )
    except subprocess.CalledProcessError:
        raise RuntimeError("Failed to pull firmware image — check credentials and image name")

    digest = _get_remote_digest(image)

    # Save
    logger.info("Saving firmware to tar")
    if on_progress:
        on_progress("Saving firmware image to disk...")
    try:
        subprocess.run(
            ["docker", "save", image, "-o", paths["firmware_tar"]],
            check=True, capture_output=True, timeout=300,
        )
    except subprocess.CalledProcessError:
        raise RuntimeError("Failed to save firmware image to disk")

    with open(paths["firmware_version"], "w") as f:
        f.write(image)
    if digest:
        with open(paths["firmware_digest"], "w") as f:
            f.write(digest)

    size_mb = os.path.getsize(paths["firmware_tar"]) // (1024 * 1024)
    logger.info("Firmware saved: %dMB", size_mb)
    if on_progress:
        on_progress(f"Firmware image ready ({size_mb}MB)")
    return paths["firmware_tar"]


def clear_firmware_cache():
    paths = get_cache_paths()
    for key in ("firmware_tar", "firmware_version", "firmware_digest"):
        if os.path.exists(paths[key]):
            os.remove(paths[key])
    logger.info("Firmware cache cleared")
