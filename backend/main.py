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
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

import solver
from validator import FORMAT, NUM_STICKERS, check_facelet, is_solved

# One image per face, six faces on a cube.
FACE_COUNT = 6

try:
    import webcam

    WEBCAM_AVAILABLE = True
except ImportError:  # pragma: no cover - OpenCV not installed
    webcam = None  # type: ignore[assignment]
    WEBCAM_AVAILABLE = False


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Building the solver tables takes a few seconds on the first run and is
    # cached afterwards. A failure here leaves the solver unavailable and the
    # solver-backed endpoints respond with 503 rather than crashing the app.
    solver.init()
    yield


app = FastAPI(title="Rubik's Cube Solver API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # Wildcard origins and credentials are mutually exclusive per the CORS spec;
    # this API is unauthenticated so credentials are not needed.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

    colors, confidence = detector.detect_face_colors(await file.read())
    if any(color is None for color in colors):
        raise HTTPException(status_code=422, detail="Could not classify every sticker on this face")
    return DetectResponse(
        facelet="".join(color for color in colors if color is not None),
        confidence=round(confidence, 3),
    )


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
