"""Rubik's Cube solver backend using Kociemba's two-phase algorithm."""

import os
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from rubik_solver import Cube, init_solver, solve, scramble as gen_scramble
    SOLVER_AVAILABLE = True
except ImportError:
    SOLVER_AVAILABLE = False

app = FastAPI(title="Rubik's Cube Solver API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize solver on startup
solver_initialized = False


@app.on_event("startup")
async def startup_event():
    global solver_initialized
    if SOLVER_AVAILABLE:
        try:
            init_solver()
            solver_initialized = True
        except Exception as e:
            print(f"Solver init failed: {e}")


class ScrambleResponse(BaseModel):
    scramble: str
    facelet: str


class SolveRequest(BaseModel):
    facelet: str


class SolveResponse(BaseModel):
    solution: str
    length: int


class ValidateRequest(BaseModel):
    facelet: str


class ValidateResponse(BaseModel):
    valid: bool
    error: Optional[str] = None


class DetectResponse(BaseModel):
    facelet: str
    confidence: float


@app.get("/api/scramble", response_model=ScrambleResponse)
async def get_scramble():
    """Generate a random 20-move scramble."""
    if not SOLVER_AVAILABLE or not solver_initialized:
        raise HTTPException(status_code=503, detail="Solver not available")
    scramble = gen_scramble()
    cube = Cube()
    cube.move(scramble)
    return ScrambleResponse(scramble=scramble, facelet=cube.as_string())


@app.post("/api/solve", response_model=SolveResponse)
async def solve_cube(req: SolveRequest):
    """Solve a cube from its facelet string representation."""
    if not SOLVER_AVAILABLE or not solver_initialized:
        raise HTTPException(status_code=503, detail="Solver not available")
    try:
        cube = Cube.from_string(req.facelet)
        solution = solve(cube, max_depth=22)
        if solution is None:
            raise HTTPException(status_code=400, detail="No solution found (cube may be invalid)")
        return SolveResponse(solution=solution, length=len(solution.split()))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid cube state: {str(e)}")


@app.post("/api/validate", response_model=ValidateResponse)
async def validate_cube(req: ValidateRequest):
    """Validate a facelet string."""
    if not SOLVER_AVAILABLE:
        return ValidateResponse(valid=False, detail="Solver not available")
    try:
        cube = Cube.from_string(req.facelet)
        result = cube.verify()
        if result is True:
            return ValidateResponse(valid=True, error=None)
        else:
            return ValidateResponse(valid=False, error=str(result))
    except Exception as e:
        return ValidateResponse(valid=False, error=str(e))


@app.post("/api/detect", response_model=DetectResponse)
async def detect_colors(file: UploadFile = File(...)):
    """Detect cube colors from an image (stub)."""
    # TODO: Implement OpenCV color detection
    return DetectResponse(facelet="UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB", confidence=0.0)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
