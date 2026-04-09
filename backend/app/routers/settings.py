import logging

import httpx
from fastapi import APIRouter

from ..models.schemas import TestConnectionRequest, TestGhcrRequest
from ..services.ssh_service import test_connection
from ..utils.error_handler import load_checklist

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/settings/test")
async def test_ssh(req: TestConnectionRequest):
    return test_connection(req.host, req.username, req.password)


@router.post("/settings/test-ghcr")
async def test_ghcr(req: TestGhcrRequest):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"token {req.token}", "Accept": "application/vnd.github.v3+json"},
                timeout=10,
            )

        if resp.status_code != 200:
            return {"success": False, "message": f"Authentication failed ({resp.status_code})"}

        user_data = resp.json()
        if user_data.get("login", "").lower() != req.username.lower():
            return {"success": False, "message": f'Token belongs to "{user_data["login"]}", not "{req.username}"'}

        image_msg = ""
        if req.image:
            import re
            m = re.match(r"ghcr\.io/([^/]+)/([^:]+)", req.image)
            if m:
                org, pkg = m.group(1), m.group(2)
                async with httpx.AsyncClient() as client:
                    pkg_resp = await client.get(
                        f"https://api.github.com/orgs/{org}/packages/container/{pkg}/versions?per_page=1",
                        headers={"Authorization": f"token {req.token}", "Accept": "application/vnd.github.v3+json"},
                        timeout=10,
                    )
                if pkg_resp.status_code == 200:
                    image_msg = f', image "{pkg}" accessible'
                else:
                    image_msg = f', but image "{pkg}" not found or no read:packages scope'

        return {"success": True, "message": f"Authenticated as {user_data['login']}{image_msg}"}

    except Exception as e:
        return {"success": False, "message": str(e)}


@router.get("/checklist")
async def get_checklist():
    return load_checklist()


@router.post("/auth/login")
async def login(credentials: dict):
    # Hardcoded for now — will be replaced with real auth
    if credentials.get("username") == "op" and credentials.get("password") == "123":
        return {"success": True, "operator_id": "op", "name": "Opérateur"}
    return {"success": False, "message": "Identifiants incorrects"}
