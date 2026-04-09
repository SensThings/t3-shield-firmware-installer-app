import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import install, sdr_test, settings, cache

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

app = FastAPI(title="T3-Shield Installer API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(install.router)
app.include_router(sdr_test.router)
app.include_router(settings.router)
app.include_router(cache.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
