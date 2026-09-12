"""FastAPI backend for the Rubik's Cube solver.

Endpoints follow the documented contract in the README:

    GET/POST /api/scramble      -> {scramble, state}
    POST     /api/solve         -> {solution, move_count, solved_state}
    POST     /api/validate      -> {valid, error}
    POST     /api/step          -> {move, new_state, step, total_steps, is_complete}
    POST     /api/webcam-scan   -> {state, confidence, face_colors}
    POST     /api/detect        -> single-face upload (9 stickers)
    POST     /api/detect/single -> single-face upload (9 stickers)

Status codes: 400 for malformed input, 422 for a well-formed but unsolvable
cube (or an unreadable scan), 503 when the solver tables are unavailable.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

import solver
from validator import FORMAT, NUM_STICKERS, check_facelet, is_solved

# ---------------------------------------------------------------------------
# Structured logging
# ---------------------------------------------------------------------------

class StructuredFormatter(logging.Formatter):
    """Emit log records as single-line JSON with a UTC timestamp.

    Keeps the output machine-parseable (CloudWatch, Datadog, jq) while still
    being readable in a terminal during local development.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            payload["exception"] = self.formatException(record.exc_info)
        # Include any extra fields the caller attached via ``extra={...}``.
        standard = {
            "args", "asctime", "created", "exc_info", "exc_text", "filename",
            "funcName", "levelname", "levelno", "lineno", "module", "msecs",
            "message", "msg", "name", "pathname", "process", "processName",
            "relativeCreated", "stack_info", "taskName", "thread", "threadName",
        }
        for key, value in record.__dict__.items():
            if key not in standard and key not in payload:
                # Only short primitives: a future extra={...} must not be able to
                # drop a request body or a base64 image into the log line.
                if isinstance(value, str):
                    payload[key] = value if len(value) <= 200 else value[:197] + "..."
                elif isinstance(value, (int, float, bool)) or value is None:
                    payload[key] = value
        # str(payload) is not JSON. It writes True and None in Python spelling, and
        # an apostrophe inside a value ends up breaking the quoting.
        return json.dumps(payload, default=str)


def _configure_logging() -> None:
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)


_configure_logging()
logger = logging.getLogger("rubik.api")

# One image per face, six faces on a cube.
FACE_COUNT = 6

try:
    import webcam

    WEBCAM_AVAILABLE = True
except ImportError:  # pragma: no cover - OpenCV not installed
    webcam = None  # type: ignore[assignment]
    WEBCAM_AVAILABLE = False

# Rate limiting. The default suits one person entering a cube: filling the net in
# and correcting a scanned cube each trigger a solve every time the cube becomes
# complete, so a limit that sounds generous per request still has to survive a
# burst of edits. Set RATE_LIMIT_MAX=0 to turn the limiter off.
RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "60"))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))

# The platform's health check must never be throttled: a 429 there reads as a
# dead service, so the deploy gets replaced. It is the supervisor, not a caller.
RATE_LIMIT_EXEMPT_PATHS = ("/api/health",)

# Only trust X-Forwarded-For when the app is genuinely behind a proxy that sets
# it. Trusting it unconditionally lets any caller choose its own bucket and walk
# past the limit. Without it, a proxied deployment counts the proxy for everyone.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "").strip().lower() in {"1", "true", "yes"}

# Buckets are pruned past this many clients, so the store cannot grow without
# bound on one entry per address that ever called.
_RATE_LIMIT_MAX_KEYS = 4096

# client key -> request timestamps inside the window
_rate_limit_store: dict[str, list[float]] = {}


def _client_key(request: Request) -> str:
    if TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            # The nearest hop is the one a trusted proxy appended; entries to its
            # left could have been supplied by the caller.
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    # Building the solver tables takes a few seconds on the first run and is
    # cached afterwards. A failure here leaves the solver unavailable and the
    # solver-backed endpoints respond with 503 rather than crashing the app.
    logger.info("Starting up: initializing solver tables")
    solver.init()
    logger.info("Startup complete: solver ready=%s", solver.is_ready())

    # No signal handlers here. uvicorn installs its own for SIGTERM and SIGINT
    # before this lifespan runs, and those are what reach this shutdown block;
    # registering our own replaced them, so the process logged that it was
    # shutting down and then kept serving until it was killed. It also broke the
    # tests, because signal.signal() only works on the main thread and TestClient
    # runs startup on a worker.
    yield

    # Shutdown: drain in-flight requests, close resources.
    logger.info("Shutting down: cleaning up resources")
    _rate_limit_store.clear()
    logger.info("Shutdown complete")


app = FastAPI(title="Rubik's Cube Solver API", version="1.0.0", lifespan=lifespan)


def _allowed_origins() -> list[str]:
    """ALLOWED_ORIGINS is a comma separated list, "*" by default.

    Splitting matters: putting the raw value straight into the list makes
    "https://a.example,https://b.example" a single origin that matches nothing,
    which looks like it works and silently does not.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", "*")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["*"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    # Wildcard origins and credentials are mutually exclusive per the CORS spec;
    # this API is unauthenticated so credentials are not needed.
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# GZip compresses responses >= 500 bytes. JSON responses (solve, scramble,
# webcam-scan) compress well and the threshold avoids wasting cycles on tiny
# responses like the health check.
app.add_middleware(GZipMiddleware, minimum_size=500)

# Chrome refuses to let a public https page reach a loopback address such as
# http://localhost:8000 unless the server opts in, which is what stops a
# statically hosted copy of the frontend from talking to a backend on the
# visitor's machine. Answer the opt-in preflight when it is asked for. Chrome
# has used both names for this header over time, so support both.
_LOCAL_NETWORK_OPT_IN = {
    "access-control-request-private-network": "Access-Control-Allow-Private-Network",
    "access-control-request-local-network": "Access-Control-Allow-Local-Network",
}


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Cap requests per client so one caller cannot occupy the solver.

    The solver is CPU bound and its tables are built once per process, so a
    scripted loop over /api/solve is enough to starve every other caller.
    """
    path = request.url.path
    if (
        RATE_LIMIT_MAX <= 0
        or not path.startswith("/api/")
        or path.startswith(RATE_LIMIT_EXEMPT_PATHS)
    ):
        return await call_next(request)

    key = _client_key(request)
    now = time.time()
    recent = [t for t in _rate_limit_store.get(key, []) if now - t < RATE_LIMIT_WINDOW]

    if len(recent) >= RATE_LIMIT_MAX:
        _rate_limit_store[key] = recent
        retry_after = max(1, int(RATE_LIMIT_WINDOW - (now - recent[0])))
        logger.warning(
            "Rate limit exceeded",
            extra={"client": key, "path": path, "retry_after": retry_after},
        )
        return JSONResponse(
            status_code=429,
            content={"detail": f"Rate limit exceeded. Try again in {retry_after} seconds."},
            headers={"Retry-After": str(retry_after)},
        )

    recent.append(now)
    _rate_limit_store[key] = recent

    # Drop buckets whose window has drained rather than hold one per address that
    # ever made a request.
    if len(_rate_limit_store) > _RATE_LIMIT_MAX_KEYS:
        for stale_key, stamps in list(_rate_limit_store.items()):
            if not stamps or now - stamps[-1] > RATE_LIMIT_WINDOW:
                del _rate_limit_store[stale_key]

    return await call_next(request)


@app.middleware("http")
async def allow_local_network_access(request, call_next):
    response = await call_next(request)
    for request_header, response_header in _LOCAL_NETWORK_OPT_IN.items():
        if request.headers.get(request_header, "").strip().lower() == "true":
            response.headers[response_header] = "true"
    return response

Facelet = str


class StateRequest(BaseModel):
    """A 54-character facelet string.

    Accepts ``facelet`` as an alias so existing clients keep working; ``state``
    is the documented field name.
    """

    state: Facelet

    @model_validator(mode="before")
    @classmethod
    def _accept_facelet_alias(cls, data):
        if isinstance(data, dict) and "state" not in data and "facelet" in data:
            return {**data, "state": data["facelet"]}
        return data


class StepRequest(StateRequest):
    step: int = Field(ge=0)


class WebcamScanRequest(BaseModel):
    """One base64 image per face. Send ``images`` (up to six) or a single
    ``image`` while capturing face by face."""

    image: Optional[str] = None
    images: Optional[List[str]] = None


class ScrambleResponse(BaseModel):
    scramble: str
    state: Facelet


class SolveResponse(BaseModel):
    solution: str
    move_count: int
    solved_state: Facelet


class ValidateResponse(BaseModel):
    valid: bool
    error: Optional[str] = None


class StepResponse(BaseModel):
    move: str
    new_state: Facelet
    step: int
    total_steps: int
    is_complete: bool


class DetectResponse(BaseModel):
    facelet: str
    confidence: float


class WebcamScanResponse(BaseModel):
    state: Facelet
    confidence: float
    face_colors: List[Optional[str]]


def _normalize(state: str) -> str:
    return state.strip().upper()


def _require_solver() -> None:
    if not solver.is_ready():
        raise HTTPException(status_code=503, detail="Solver not available")


def _validate(state: str) -> str:
    """Validate a facelet string and return it normalised, or raise."""
    normalized = _normalize(state)
    result = check_facelet(normalized)
    if not result.ok:
        status = 400 if result.kind == FORMAT else 422
        raise HTTPException(status_code=status, detail=result.error)
    return normalized


def _decode_base64_image(payload: str) -> bytes:
    text = "".join(payload.split())
    if text.startswith("data:"):
        _, _, text = text.partition(",")
        text = "".join(text.split())
    if not text:
        raise HTTPException(status_code=400, detail="image is empty")
    text += "=" * (-len(text) % 4)
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="image is not valid base64")


def _require_webcam() -> Any:
    if not WEBCAM_AVAILABLE:
        raise HTTPException(status_code=503, detail="OpenCV not available")
    return webcam


@app.get("/api/health")
async def health() -> dict[str, Any]:
    """Liveness for a platform health check, and a quick manual look.

    Reports the solver separately because the tables take a few seconds to
    build: the app is up before it can solve, and a 200 here with
    solver_ready false is a starting service rather than a broken one.
    """
    ready = solver.is_ready()
    logger.info("Health check", extra={"solver_ready": ready, "webcam_available": WEBCAM_AVAILABLE})
    return {"status": "ok", "solver_ready": ready, "webcam_available": WEBCAM_AVAILABLE}


@app.get("/api/scramble", response_model=ScrambleResponse)
@app.post("/api/scramble", response_model=ScrambleResponse)
async def get_scramble() -> ScrambleResponse:
    """Generate a random scramble and the cube state it produces."""
    _require_solver()
    result = solver.random_scramble()
    if result is None:
        raise HTTPException(status_code=503, detail="Solver not available")
    scramble, state = result
    return ScrambleResponse(scramble=scramble, state=state)


@app.post("/api/solve", response_model=SolveResponse)
async def solve_cube(req: StateRequest) -> SolveResponse:
    """Solve a cube from its facelet string."""
    _require_solver()
    state = _validate(req.state)

    moves = solver.solve_facelet(state)
    if moves is None:
        raise HTTPException(status_code=422, detail="No solution found within 22 moves")

    solution = " ".join(moves)
    solved_state = solver.apply_moves(state, solution)
    if solved_state is None:
        raise HTTPException(status_code=500, detail="Solver produced an unreadable state")
    if not is_solved(solved_state):
        # Applying the moves must actually solve the cube; if it does not, the
        # tables are wrong and reporting the sequence would be a silent lie.
        raise HTTPException(
            status_code=500,
            detail="Solver returned a move sequence that does not solve this cube",
        )
    return SolveResponse(solution=solution, move_count=len(moves), solved_state=solved_state)


@app.post("/api/validate", response_model=ValidateResponse)
async def validate_cube(req: StateRequest) -> ValidateResponse:
    """Validate a facelet string. Does not need the solver tables."""
    result = check_facelet(_normalize(req.state))
    return ValidateResponse(valid=result.ok, error=result.error)


@app.post("/api/step", response_model=StepResponse)
async def step_cube(req: StepRequest) -> StepResponse:
    """Return one move of the solution at ``step`` and the resulting state."""
    _require_solver()
    state = _validate(req.state)

    moves = solver.solve_facelet(state)
    if moves is None:
        raise HTTPException(status_code=422, detail="No solution found within 22 moves")
    if not moves:
        raise HTTPException(status_code=422, detail="Cube is already solved")

    total = len(moves)
    if req.step >= total:
        raise HTTPException(
            status_code=400, detail=f"step must be between 0 and {total - 1}"
        )

    prefix = " ".join(moves[: req.step + 1])
    new_state = solver.apply_moves(state, prefix)
    if new_state is None:
        raise HTTPException(status_code=500, detail="Solver produced an unreadable state")

    return StepResponse(
        move=moves[req.step],
        new_state=new_state,
        step=req.step,
        total_steps=total,
        is_complete=req.step == total - 1,
    )


@app.post("/api/webcam-scan", response_model=WebcamScanResponse)
async def webcam_scan(req: WebcamScanRequest) -> WebcamScanResponse:
    """Detect the cube state from base64 face images.

    Send six images (one per face, in U, R, F, D, L, B order) for a complete
    54-sticker state, or a single ``image`` to scan one face at a time.
    """
    detector = _require_webcam()

    payloads = req.images if req.images else ([req.image] if req.image else [])
    if not payloads:
        raise HTTPException(status_code=400, detail="Provide 'image' or 'images'")
    if len(payloads) > FACE_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"At most {FACE_COUNT} face images are accepted (got {len(payloads)})",
        )

    # Validate payload sizes before decoding
    for payload in payloads:
        if len(payload) > 2 * 1024 * 1024:  # ~2MB base64 limit
            raise HTTPException(
                status_code=413,
                detail=f"Image payload too large (max ~2 MB base64)"
            )

    face_colors: List[Optional[str]] = []
    scores: List[float] = []
    for payload in payloads:
        colors, confidence = detector.detect_face_colors(_decode_base64_image(payload))
        face_colors.extend(colors)
        scores.append(confidence)

    unmatched = sum(1 for color in face_colors if color is None)
    detected = len(face_colors) - unmatched
    confidence = (sum(scores) / len(scores)) * (detected / len(face_colors))

    if len(face_colors) != NUM_STICKERS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Detected {len(face_colors)} stickers from {len(payloads)} image(s); "
                f"a full cube needs {FACE_COUNT} faces ({NUM_STICKERS} stickers)"
            ),
        )
    if unmatched:
        raise HTTPException(
            status_code=422,
            detail=f"Could not classify {unmatched} sticker(s); retake under even lighting",
        )

    state = "".join(color for color in face_colors if color is not None)
    result = check_facelet(state)
    if not result.ok:
        raise HTTPException(status_code=422, detail=f"Detected state is not solvable: {result.error}")

    return WebcamScanResponse(
        state=state, confidence=round(confidence, 3), face_colors=face_colors
    )


@app.post("/api/detect", response_model=DetectResponse)
@app.post("/api/detect/single", response_model=DetectResponse)
async def detect_single_face(file: UploadFile = File(...)) -> DetectResponse:
    """Detect the nine stickers of a single uploaded face image."""
    detector = _require_webcam()
    
    # Limit file size to 5 MB
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum 5 MB.")
    
    colors, confidence = detector.detect_face_colors(content)
    if any(color is None for color in colors):
        raise HTTPException(status_code=422, detail="Could not classify every sticker on this face")
    return DetectResponse(
        facelet="".join(color for color in colors if color is not None),
        confidence=round(confidence, 3),
    )


# Keep /api answers JSON. The frontend is mounted at "/" below, which would
# otherwise answer a mistyped or wrong-method API path with the static file
# handler's HTML 404, and a JSON client cannot tell that apart from the backend
# being absent. Declared after the real routes so those still win.
@app.api_route(
    "/api/{rest:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def unknown_api_path(rest: str) -> Any:
    raise HTTPException(status_code=404, detail=f"No such endpoint: /api/{rest}")


# Serve the built frontend from this same origin when it exists, so
# `uvicorn main:app` and http://localhost:8000 is the whole app: one process,
# one URL, no proxy and no cross-origin rules to satisfy. Mounted last so the
# /api routes declared above keep precedence. Build it with `npm run build`
# (no VITE_API_URL needed, since the API is same-origin).
_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST_DIR), html=True), name="ui")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
