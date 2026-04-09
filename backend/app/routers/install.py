import asyncio
import json
import logging
import time
import threading
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..models.schemas import InstallRequest
from ..services.installer import run_install

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory store for active installations
active_installs: dict[str, dict[str, Any]] = {}


@router.post("/install")
async def start_install(req: InstallRequest):
    serial = req.serial_number
    if not serial or len(serial) < 3 or not serial.isalnum():
        return {"success": False, "error": "Invalid serial number"}

    install_id = f"{serial}-{int(time.time() * 1000)}"
    logger.info("Starting install %s for serial %s", install_id, serial)

    active_installs[install_id] = {
        "events": [],
        "status": "running",
        "result": None,
        "error": None,
    }

    def emit(event_type: str, data: dict):
        inst = active_installs.get(install_id)
        if inst:
            inst["events"].append({"type": event_type, "data": data, "timestamp": time.time()})
            if event_type == "install_complete":
                inst["status"] = "completed"
                inst["result"] = data
            elif event_type == "install_error":
                inst["status"] = "failed"
                inst["error"] = data.get("error", "Unknown error")

    def run():
        try:
            run_install(serial, req.settings, emit)
        except Exception as e:
            logger.error("Install %s failed: %s", install_id, str(e))
            inst = active_installs.get(install_id)
            if inst and inst["status"] == "running":
                inst["status"] = "failed"
                inst["error"] = str(e)
                inst["events"].append({"type": "install_error", "data": {"error": str(e)}, "timestamp": time.time()})

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    return {"success": True, "install_id": install_id}


@router.get("/install/{install_id}/progress")
async def install_progress(install_id: str):
    inst = active_installs.get(install_id)
    if not inst:
        return {"success": False, "error": "Installation not found"}

    async def event_stream():
        last_index = 0
        while True:
            while last_index < len(inst["events"]):
                event = inst["events"][last_index]
                yield f"data: {json.dumps(event)}\n\n"
                last_index += 1

            if inst["status"] != "running":
                yield f"data: {json.dumps({'type': 'done', 'data': {'status': inst['status'], 'result': inst.get('result'), 'error': inst.get('error')}})}\n\n"
                # Cleanup after 60s
                asyncio.get_event_loop().call_later(60, lambda: active_installs.pop(install_id, None))
                break

            await asyncio.sleep(0.1)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
