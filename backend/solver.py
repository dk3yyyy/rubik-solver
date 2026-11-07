"""Thin wrapper around the Kociemba two-phase solver.

The underlying ``rubik-solver-py`` package needs ``init_solver()`` to run once
before any cube arithmetic works -- ``Cube.move()`` raises ``IndexError`` until
the move tables exist -- so every entry point here checks readiness first and
the API reports ``503`` when the solver is not usable instead of crashing.

Requires ``numpy>=2.1``: the pinned 1.26.4 has no wheels for Python 3.13+ and a
source build on 3.14 corrupts the table construction, which makes
``init_solver()`` raise ``IndexError`` at import time.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import List, Optional, Tuple

from validator import _canonicalize, validate_facelet

try:  # pragma: no cover - exercised through the API tests
    from rubik_solver import Cube, init_solver, solve as _solve
    SOLVER_AVAILABLE = True
except ImportError:  # pragma: no cover
    SOLVER_AVAILABLE = False

SOLVED_FACELET = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
FACES = "URFDLB"
SUFFIXES = ("", "'", "2")

logger = logging.getLogger("rubik.solver")

_solver_ready = False
# The build mutates the library's global tables, so two requests must not run
# it at the same time.
_solver_lock = threading.Lock()
# How long to wait before trying a failed build again. Without a pause, a
# permanently broken build would rebuild its tables on every request.
_RETRY_AFTER_FAILURE = 5.0
_last_failure: Optional[float] = None


def is_available() -> bool:
    """Whether the solver package imported at all."""
    return SOLVER_AVAILABLE


def is_ready() -> bool:
    """Whether the solver tables have been built and the solver can be used."""
    return SOLVER_AVAILABLE and _solver_ready


def init() -> bool:
    """Build the solver tables once. Returns True when the solver is usable."""
    global _solver_ready, _last_failure
    if _solver_ready:
        return True
    if not SOLVER_AVAILABLE:
        return False
    with _solver_lock:
        if _solver_ready:
            return True
        now = time.monotonic()
        if _last_failure is not None and now - _last_failure < _RETRY_AFTER_FAILURE:
            return False
        try:
            init_solver()
        except Exception:
            _last_failure = now
            logger.exception("Solver table build failed; will retry")
            return False
        _solver_ready = True
        _last_failure = None
        return True


def random_scramble(moves: int = 20) -> Optional[Tuple[str, str]]:
    """Return ``(scramble, facelet)`` for a random legal state.

    Generates the scramble directly instead of using the library's
    ``scramble()``, which solves a random cube to derive a sequence and is much
    slower. Consecutive turns of the same face are skipped so the state is not
    trivially reducible.
    """
    if not is_ready():
        return None

    sequence: List[str] = []
    previous_face = None
    for _ in range(moves):
        face = random.choice(FACES)
        while face == previous_face:
            face = random.choice(FACES)
        previous_face = face
        sequence.append(face + random.choice(SUFFIXES))

    scramble = " ".join(sequence)
    cube = Cube()
    cube.move(scramble)
    return scramble, cube.as_string()


def apply_moves(facelet: str, moves: str) -> Optional[str]:
    """Apply ``moves`` to ``facelet`` and return the resulting facelet string."""
    if not is_ready():
        return None
    # The validator accepts a cube whose centres carry any colour scheme, but
    # the library parses facelets by their literal U/R/F/... letters. Relabel
    # to the standard scheme first, or the moves get applied to a different
    # cube than the one the caller described.
    facelet = _canonicalize(facelet)
    if not moves or not moves.strip():
        return facelet
    cube = Cube.from_string(facelet)
    cube.move(moves)
    return cube.as_string()


def solve_facelet(facelet: str, max_depth: int = 22) -> Optional[List[str]]:
    """Solve ``facelet`` and return the moves as a list.

    Returns an empty list when the cube is already solved, or ``None`` when the
    solver could not find a solution within ``max_depth``.
    """
    if not is_ready():
        return None
    # See apply_moves: the validator canonicalises any colour scheme, so the
    # solver has to read the same normalised cube.
    facelet = _canonicalize(facelet)
    cube = Cube.from_string(facelet)
    if cube.as_string() == SOLVED_FACELET:
        return []
    solution = _solve(cube, max_depth=max_depth)
    if not solution or not solution.strip():
        return None
    return solution.split()


def validate(facelet: object) -> Tuple[bool, Optional[str]]:
    """Validate a facelet string; see :mod:`validator`."""
    return validate_facelet(facelet)
