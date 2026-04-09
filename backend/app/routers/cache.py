from fastapi import APIRouter
from ..services.offline_assets import get_cache_status, clear_firmware_cache

router = APIRouter()


@router.get("/cache")
async def cache_status():
    try:
        status = get_cache_status()
        return {"success": True, **status}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/cache")
async def clear_cache():
    try:
        clear_firmware_cache()
        return {"success": True, "message": "Firmware cache cleared"}
    except Exception as e:
        return {"success": False, "error": str(e)}
