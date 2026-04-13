import logging
import os
import subprocess
import tempfile
import time
from typing import Callable, Optional

import paramiko

logger = logging.getLogger(__name__)


class SSHConnection:
    def __init__(self, client: paramiko.SSHClient, host: str = "", username: str = "", password: str = ""):
        self.client = client
        self._host = host
        self._username = username
        self._password = password

    def exec_command(self, cmd: str, timeout: int = 60) -> tuple[str, str, int]:
        """Execute command, return (stdout, stderr, exit_code)."""
        _, stdout, stderr = self.client.exec_command(cmd, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        try:
            out = stdout.read().decode()
        except UnicodeDecodeError:
            out = stdout.read().decode("utf-8", errors="replace")
            logger.warning("SSH stdout decode error (replaced invalid bytes)")
        try:
            err = stderr.read().decode()
        except UnicodeDecodeError:
            err = stderr.read().decode("utf-8", errors="replace")
            logger.warning("SSH stderr decode error (replaced invalid bytes)")
        return out, err, exit_code

    def exec_stream(self, cmd: str, on_output: Callable[[str], None], timeout: int = 900) -> int:
        """Execute command with streaming output."""
        _, stdout, stderr = self.client.exec_command(cmd, timeout=timeout)

        # Read from both channels
        channel = stdout.channel
        while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
            if channel.recv_ready():
                try:
                    data = channel.recv(4096).decode()
                except UnicodeDecodeError:
                    data = channel.recv(4096).decode("utf-8", errors="replace")
                if data:
                    on_output(data)
            if channel.recv_stderr_ready():
                try:
                    data = channel.recv_stderr(4096).decode()
                except UnicodeDecodeError:
                    data = channel.recv_stderr(4096).decode("utf-8", errors="replace")
                if data:
                    on_output(data)

        # Drain remaining
        while channel.recv_ready():
            try:
                data = channel.recv(4096).decode()
            except UnicodeDecodeError:
                data = channel.recv(4096).decode("utf-8", errors="replace")
            if data:
                on_output(data)
        while channel.recv_stderr_ready():
            try:
                data = channel.recv_stderr(4096).decode()
            except UnicodeDecodeError:
                data = channel.recv_stderr(4096).decode("utf-8", errors="replace")
            if data:
                on_output(data)

        return channel.recv_exit_status()

    def upload_file(self, content: str, remote_path: str):
        """Upload text content to remote path via SFTP."""
        sftp = self.client.open_sftp()
        try:
            with sftp.file(remote_path, "w") as f:
                f.write(content)
        finally:
            sftp.close()

    def upload_large_file(
        self,
        local_path: str,
        remote_path: str,
        on_progress: Optional[Callable[[int], None]] = None,
    ):
        """Upload a large binary file. Uses SCP (2x faster) with SFTP fallback."""
        file_size = os.path.getsize(local_path)
        size_mb = file_size // (1024 * 1024)

        # Try SCP first (2x faster than Paramiko SFTP on Gigabit Ethernet)
        if self._host and self._password:
            try:
                return self._upload_scp(local_path, remote_path, file_size, on_progress)
            except Exception as e:
                logger.warning("SCP failed, falling back to SFTP: %s", e)

        # Fallback: Paramiko SFTP
        self._upload_sftp(local_path, remote_path, on_progress)

    def _upload_scp(
        self,
        local_path: str,
        remote_path: str,
        file_size: int,
        on_progress: Optional[Callable[[int], None]] = None,
    ):
        """Upload via SCP subprocess (faster than Paramiko SFTP)."""
        # Create askpass script for non-interactive password
        askpass_fd, askpass_path = tempfile.mkstemp(suffix=".sh")
        try:
            with os.fdopen(askpass_fd, "w") as f:
                f.write(f"#!/bin/bash\necho '{self._password}'\n")
            os.chmod(askpass_path, 0o700)

            env = os.environ.copy()
            env["SSH_ASKPASS"] = askpass_path
            env["SSH_ASKPASS_REQUIRE"] = "force"
            env["DISPLAY"] = ":0"

            start = time.time()
            result = subprocess.run(
                ["scp", "-o", "StrictHostKeyChecking=no", "-o", "Compression=no",
                 local_path, f"{self._username}@{self._host}:{remote_path}"],
                capture_output=True, text=True, timeout=600, env=env,
            )
            elapsed = time.time() - start

            if result.returncode != 0:
                raise RuntimeError(f"SCP exit code {result.returncode}: {result.stderr[:200]}")

            speed = (file_size / (1024 * 1024)) / elapsed if elapsed > 0 else 0
            logger.info("SCP upload complete: %.0fMB in %.1fs (%.1f MB/s)",
                        file_size / (1024 * 1024), elapsed, speed)

            if on_progress:
                on_progress(100)
        finally:
            os.unlink(askpass_path)

    def _upload_sftp(
        self,
        local_path: str,
        remote_path: str,
        on_progress: Optional[Callable[[int], None]] = None,
    ):
        """Upload via Paramiko SFTP (fallback)."""
        sftp = self.client.open_sftp()
        try:
            last_pct = -10

            def progress_callback(transferred: int, total: int):
                nonlocal last_pct
                if total == 0:
                    return
                pct = int(transferred * 100 / total)
                if pct - last_pct >= 10:
                    last_pct = pct
                    logger.info("  Upload: %d%%", pct)
                    if on_progress:
                        on_progress(pct)

            sftp.put(local_path, remote_path, callback=progress_callback)
        finally:
            sftp.close()

    def close(self):
        self.client.close()


def connect(host: str, username: str, password: str, timeout: int = 10) -> SSHConnection:
    """Create an SSH connection."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=22, username=username, password=password, timeout=timeout)
    return SSHConnection(client, host=host, username=username, password=password)


def test_connection(host: str, username: str, password: str) -> dict:
    """Test SSH connectivity, return result dict."""
    start = time.time()
    try:
        conn = connect(host, username, password, timeout=5)
        latency_ms = int((time.time() - start) * 1000)
        conn.close()
        return {"success": True, "message": f"Connected ({latency_ms}ms)", "latency_ms": latency_ms}
    except paramiko.AuthenticationException:
        latency_ms = int((time.time() - start) * 1000)
        return {"success": False, "message": "Authentication failed — check credentials in Settings", "latency_ms": latency_ms}
    except Exception as e:
        latency_ms = int((time.time() - start) * 1000)
        msg = str(e)
        if "timed out" in msg.lower() or "refused" in msg.lower():
            return {"success": False, "message": f"Cannot reach device at {host} — check Ethernet cable", "latency_ms": latency_ms}
        return {"success": False, "message": msg, "latency_ms": latency_ms}
