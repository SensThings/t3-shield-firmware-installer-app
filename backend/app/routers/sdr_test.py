import asyncio
import json
import logging
import time
import threading
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..models.schemas import SdrTestRequest
from ..services.sdr_tester import run_sdr_test

logger = logging.getLogger(__name__)
router = APIRouter()

active_tests: dict[str, dict[str, Any]] = {}


@router.post("/sdr-test")
async def start_sdr_test(req: SdrTestRequest):
    serial = req.serial_number
    if not serial or len(serial) < 3 or not serial.isalnum():
        return {"success": False, "error": "Invalid serial number"}

    test_id = f"sdr-{serial}-{int(time.time() * 1000)}"
    logger.info("Starting SDR test %s for serial %s", test_id, serial)

    active_tests[test_id] = {
        "events": [],
        "status": "running",
        "result": None,
        "error": None,
    }

    def emit(event_type: str, data: dict):
        test = active_tests.get(test_id)
        if test:
            test["events"].append({"type": event_type, "data": data, "timestamp": time.time()})
            if event_type == "test_complete":
                test["status"] = "completed"
                test["result"] = data
            elif event_type == "test_error":
                test["status"] = "failed"
                test["error"] = data.get("error", "Unknown error")

    def run():
        try:
            run_sdr_test(serial, req.settings, emit)
        except Exception as e:
            logger.error("SDR test %s failed: %s", test_id, str(e))
            test = active_tests.get(test_id)
            if test and test["status"] == "running":
                test["status"] = "failed"
                test["error"] = str(e)
                test["events"].append({"type": "test_error", "data": {"error": str(e)}, "timestamp": time.time()})

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    return {"success": True, "test_id": test_id}


@router.get("/sdr-test/{test_id}/progress")
async def sdr_test_progress(test_id: str):
    test = active_tests.get(test_id)
    if not test:
        return {"success": False, "error": "Test not found"}

    async def event_stream():
        last_index = 0
        while True:
            while last_index < len(test["events"]):
                event = test["events"][last_index]
                yield f"data: {json.dumps(event)}\n\n"
                last_index += 1

            if test["status"] != "running":
                yield f"data: {json.dumps({'type': 'done', 'data': {'status': test['status'], 'result': test.get('result'), 'error': test.get('error')}})}\n\n"
                asyncio.get_event_loop().call_later(60, lambda: active_tests.pop(test_id, None))
                break

            await asyncio.sleep(0.1)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
