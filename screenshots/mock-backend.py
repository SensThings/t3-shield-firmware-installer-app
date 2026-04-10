"""Minimal mock backend for taking screenshots of the UI flow."""
import json
import time
import threading
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

# Simulated install progress events
INSTALL_EVENTS = []
SDR_EVENTS = []

CHECKLIST = [
    {"id": "sdr_desktop_connected", "label": "SDR connecté à l'ordinateur"},
    {"id": "ethernet_connected", "label": "Câble Ethernet branché à l'ordinateur"},
    {"id": "serial_label_visible", "label": "Étiquette du numéro de série visible sur l'appareil"},
]

PREP_STEPS = [
    ("prepare_docker", "Préparer les binaires Docker"),
    ("prepare_firmware", "Préparer l'image firmware"),
    ("upload_script", "Transférer le script d'installation"),
    ("upload_docker", "Transférer les binaires Docker"),
    ("upload_firmware", "Transférer l'image firmware"),
]

INSTALL_STEPS = [
    "set_hostname", "expand_partition", "configure_network", "docker_install",
    "create_dirs", "write_config", "registry_login", "pull_image",
    "install_update_script", "start_container", "health_check", "sdr_warmup", "sdr_verify",
]

SDR_PREP_STEPS = [
    ("check_desktop_sdr", "Vérifier le SDR du poste"),
    ("upload_test_scripts", "Transférer les scripts de test"),
    ("start_transmitter", "Démarrer l'émetteur"),
]

SDR_TEST_STEPS = ["init_receiver", "run_test", "validate_results"]


def generate_install_events(install_id):
    events = []
    # Prep steps - fast
    for sid, label in PREP_STEPS:
        events.append(json.dumps({"type": "prep_step", "data": {"step_id": sid, "status": "in_progress"}}))
        events.append(json.dumps({"type": "prep_step", "data": {"step_id": sid, "status": "pass"}}))

    # Install steps
    for i, sid in enumerate(INSTALL_STEPS):
        n = i + 1
        events.append(json.dumps({"type": "step_update", "data": {"step_number": n, "status": "in_progress"}}))
        events.append(json.dumps({"type": "step_update", "data": {"step_number": n, "status": "pass", "duration": round(1.5 + i * 0.3, 1)}}))

    # Complete
    events.append(json.dumps({"type": "install_complete", "data": {
        "result": "pass",
        "operation": "install",
        "image": "ghcr.io/sensthings/t3shield-firmware:latest",
        "version": "1.0.5",
        "started_at": "2026-04-10T10:00:00Z",
        "finished_at": "2026-04-10T10:05:23Z",
        "steps": [],
    }}))
    INSTALL_EVENTS.append((install_id, events))


def generate_sdr_events(test_id):
    events = []
    for sid, label in SDR_PREP_STEPS:
        events.append(json.dumps({"type": "prep_step", "data": {"step_id": sid, "status": "in_progress"}}))
        events.append(json.dumps({"type": "prep_step", "data": {"step_id": sid, "status": "pass"}}))

    for i, sid in enumerate(SDR_TEST_STEPS):
        n = i + 1
        events.append(json.dumps({"type": "step_update", "data": {"step_number": n, "status": "in_progress"}}))
        events.append(json.dumps({"type": "step_update", "data": {"step_number": n, "status": "pass", "duration": round(2.0 + i * 1.5, 1)}}))

    events.append(json.dumps({"type": "test_complete", "data": {
        "result": "pass",
        "operation": "sdr_test",
        "started_at": "2026-04-10T10:06:00Z",
        "finished_at": "2026-04-10T10:06:45Z",
        "steps": [],
        "metrics": {
            "status": "PASS",
            "peak_freq_hz": 884100523.4,
            "expected_freq_hz": 884100000.0,
            "freq_error_hz": 523.4,
            "snr_db": 22.3,
            "snr_threshold_db": 15.0,
            "peak_power_db": -8.2,
            "noise_floor_db": -30.5,
        },
    }}))
    SDR_EVENTS.append((test_id, events))


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "version": "1.0.5"})
        elif self.path == "/checklist":
            self._json(CHECKLIST)
        elif self.path.startswith("/install/") and self.path.endswith("/progress"):
            self._sse_stream(INSTALL_EVENTS)
        elif self.path.startswith("/sdr-test/") and self.path.endswith("/progress"):
            self._sse_stream(SDR_EVENTS)
        elif self.path == "/cache":
            self._json({"docker_binaries": True, "firmware_image": True, "firmware_tag": "latest"})
        elif self.path.startswith("/settings/test"):
            self._json({"success": True, "message": "Connected", "latency_ms": 12})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"

        if self.path == "/auth/login":
            self._json({"success": True})
        elif self.path == "/install":
            iid = f"mock-{uuid.uuid4().hex[:8]}"
            generate_install_events(iid)
            self._json({"success": True, "install_id": iid})
        elif self.path == "/sdr-test":
            tid = f"mock-{uuid.uuid4().hex[:8]}"
            generate_sdr_events(tid)
            self._json({"success": True, "test_id": tid})
        elif self.path == "/settings/test":
            self._json({"success": True, "message": "Connecté (12ms)", "latency_ms": 12})
        elif self.path == "/settings/test-ghcr":
            self._json({"success": True, "message": "Accès vérifié"})
        else:
            self._json({"success": True})

    def _sse_stream(self, event_store):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        # Find the events for this path
        events = []
        for eid, evts in event_store:
            events = evts
            break

        for evt in events:
            self.wfile.write(f"data: {evt}\n\n".encode())
            self.wfile.flush()
            time.sleep(1.5)

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        pass  # silent


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), Handler)
    print("Mock backend on http://localhost:8000")
    server.serve_forever()
