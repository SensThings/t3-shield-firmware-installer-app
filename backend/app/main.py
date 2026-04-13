import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import install, sdr_test, antenna_test, sdr_config, settings, cache

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

# Read version from VERSION file (two levels up from app/)
_version_file = Path(__file__).resolve().parent.parent.parent / "VERSION"
APP_VERSION = _version_file.read_text().strip() if _version_file.exists() else "dev"

app = FastAPI(title="T3-Shield Installer API", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)

app.include_router(install.router)
app.include_router(sdr_test.router)
app.include_router(antenna_test.router)
app.include_router(sdr_config.router)
app.include_router(settings.router)
app.include_router(cache.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}
