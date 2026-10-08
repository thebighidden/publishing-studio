from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth as studio_auth
from . import creative_jobs
from .api import accounts, auth, campaigns, creative, phones, providers, runs, system, workflows
from .config import EVIDENCE_DIR, MEDIA_DIR
from .db import init_db
from .devices.base import DeviceError
from .providers.base import ProviderError
from .publishing import events
from .publishing.scheduler import scheduler
from .seed import seed_if_empty


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    seed_if_empty()
    events.bind_loop(asyncio.get_running_loop())
    scheduler.start()
    creative_jobs.worker.start()
    try:
        yield
    finally:
        creative_jobs.worker.shutdown()
        scheduler.shutdown()


app = FastAPI(
    title="AI Publishing Studio",
    version="0.1.0",
    description="Campaign brief in, approved posts out, published from a real phone.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _require_auth(request: Request, call_next):
    path = request.url.path
    is_protected = path.startswith("/api/") or path.startswith("/media/") or path.startswith("/evidence/")
    is_open = path.startswith("/api/auth/") or path == "/api/health" or request.method == "OPTIONS"
    if is_protected and not is_open:
        user = studio_auth.validate_token(request.cookies.get(studio_auth.COOKIE_NAME))
        if user is None:
            return JSONResponse(status_code=401, content={"detail": "authentication required"})
        request.state.user = user
    return await call_next(request)


@app.exception_handler(ProviderError)
async def _provider_error(_request, exc: ProviderError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc), "retryable": exc.retryable, "source": "provider"},
    )


@app.exception_handler(DeviceError)
async def _device_error(_request, exc: DeviceError):
    return JSONResponse(status_code=502, content={"detail": str(exc), "source": "device"})


app.include_router(auth.router)
app.include_router(system.router)
app.include_router(providers.router)
app.include_router(creative.router)
app.include_router(workflows.router)
app.include_router(phones.router)
app.include_router(accounts.router)
app.include_router(campaigns.router)
app.include_router(runs.router)

app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/evidence", StaticFiles(directory=EVIDENCE_DIR), name="evidence")
