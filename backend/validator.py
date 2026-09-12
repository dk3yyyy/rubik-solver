"""Cube-state validation that does not rely on the solver's own checks.

The bundled ``rubik-solver-py`` library exposes ``Cube.verify()``, but that
method operates on the library's internal piece model and accepts states that
are not reachable on a real cube (for example two swapped stickers that keep the
per-colour counts at nine).  Because ``/api/validate`` is a documented endpoint
and ``/api/solve`` must reject impossible cubes with a ``422``, the API checks
the facelet string here before it ever reaches the solver.

The sticker layout is the standard Kociemba one:

    region 0-8   U face
    region 9-17  R face
    region 18-26 F face
    region 27-35 D face
    region 36-44 L face
    region 45-53 B face

Format checks (length, alphabet, one colour nine times) catch malformed input
and map to HTTP 400.  Solvability checks (piece identity, corner twist, edge
flip, permutation parity) catch well-formed but impossible cubes and map to
HTTP 422.
"""

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

FACE_LETTERS = "URFDLB"
NUM_STICKERS = 54
CENTER_INDICES = (4, 13, 22, 31, 40, 49)

FORMAT = "format"
UNSOLVABLE = "unsolvable"

# Facelet positions of each corner / edge, in the standard Kociemba order, with
# the colour triple/pair each piece must show under a canonical orientation.
CORNER_FACELET: Tuple[Tuple[int, int, int], ...] = (
    (8, 9, 20), (6, 18, 38), (0, 36, 47), (2, 45, 11),
    (29, 26, 15), (27, 44, 24), (33, 53, 42), (35, 17, 51),
)
CORNER_COLORS: Tuple[Tuple[str, str, str], ...] = (
    ("U", "R", "F"), ("U", "F", "L"), ("U", "L", "B"), ("U", "B", "R"),
    ("D", "F", "R"), ("D", "L", "F"), ("D", "B", "L"), ("D", "R", "B"),
)
EDGE_FACELET: Tuple[Tuple[int, int], ...] = (
    (5, 10), (7, 19), (3, 37), (1, 46), (32, 16), (28, 25),
    (30, 43), (34, 52), (23, 12), (21, 41), (50, 39), (48, 14),
)
EDGE_COLORS: Tuple[Tuple[str, str], ...] = (
    ("U", "R"), ("U", "F"), ("U", "L"), ("U", "B"), ("D", "R"), ("D", "F"),
    ("D", "L"), ("D", "B"), ("F", "R"), ("F", "L"), ("B", "L"), ("B", "R"),
)


@dataclass
class ValidationResult:
    ok: bool
    error: Optional[str] = None
    kind: Optional[str] = None  # FORMAT or UNSOLVABLE when not ok


def check_format(facelet: object) -> ValidationResult:
    """Length, alphabet and per-colour counts."""
    if not isinstance(facelet, str):
        return ValidationResult(False, "Facelet must be a string", FORMAT)

    text = facelet.strip().upper()
    if len(text) != NUM_STICKERS:
        return ValidationResult(
            False, f"Facelet must be {NUM_STICKERS} characters (got {len(text)})", FORMAT
        )

    invalid = sorted(set(text) - set(FACE_LETTERS))
    if invalid:
        return ValidationResult(
            False,
            f"Invalid characters: {''.join(invalid)} (allowed: {', '.join(FACE_LETTERS)})",
            FORMAT,
        )

    for letter in FACE_LETTERS:
        count = text.count(letter)
        if count != 9:
            return ValidationResult(
                False, f"Face {letter} appears {count} times, expected 9", FORMAT
            )

    centers = [text[i] for i in CENTER_INDICES]
    if len(set(centers)) != 6:
        return ValidationResult(
            False, "The six centre stickers must be six different colours", FORMAT
        )

    return ValidationResult(True)


def _canonicalize(facelet: str) -> str:
    """Relabel colours so the up/front/right faces carry U, F, R."""
    centers = [facelet[i] for i in CENTER_INDICES]
    relabel = {color: FACE_LETTERS[i] for i, color in enumerate(centers)}
    return "".join(relabel[ch] for ch in facelet)


def _locate(colors: Sequence[str], table: Sequence[Sequence[str]]) -> Tuple[Optional[int], int]:
    """Return the reference piece ``colors`` matches and its orientation."""
    width = len(table[0])
    for piece, reference in enumerate(table):
        for orientation in range(width):
            rotated = tuple(colors[orientation:]) + tuple(colors[:orientation])
            if rotated == tuple(reference):
                return piece, orientation
    return None, 0


def _parity(permutation: Sequence[int]) -> int:
    """0 for an even permutation, 1 for an odd one (inversion count mod 2)."""
    inversions = 0
    for i in range(len(permutation)):
        for j in range(i + 1, len(permutation)):
            if permutation[i] > permutation[j]:
                inversions += 1
    return inversions % 2


def check_solvable(facelet: object) -> ValidationResult:
    """Piece identity, corner twist, edge flip and permutation parity.

    Runs the format checks first, so a direct call with short or non-string
    input returns a format failure instead of raising an IndexError.
    """
    fmt = check_format(facelet)
    if not fmt.ok:
        return fmt

    text = str(facelet).strip().upper()
    canonical = _canonicalize(text)

    corner_perm: List[int] = []
    corner_orientation = 0
    for facelets in CORNER_FACELET:
        piece, orientation = _locate([canonical[i] for i in facelets], CORNER_COLORS)
        if piece is None:
            return ValidationResult(
                False,
                "Invalid corner piece: those three stickers cannot share a corner",
                UNSOLVABLE,
            )
        corner_perm.append(piece)
        corner_orientation += orientation

    edge_perm: List[int] = []
    edge_orientation = 0
    for facelets in EDGE_FACELET:
        piece, orientation = _locate([canonical[i] for i in facelets], EDGE_COLORS)
        if piece is None:
            return ValidationResult(
                False,
                "Invalid edge piece: those two stickers cannot share an edge",
                UNSOLVABLE,
            )
        edge_perm.append(piece)
        edge_orientation += orientation

    if sorted(corner_perm) != list(range(8)):
        return ValidationResult(False, "Duplicate or missing corner cubie", UNSOLVABLE)
    if sorted(edge_perm) != list(range(12)):
        return ValidationResult(False, "Duplicate or missing edge cubie", UNSOLVABLE)
    if corner_orientation % 3 != 0:
        return ValidationResult(False, "Corner twist error: one corner is twisted", UNSOLVABLE)
    if edge_orientation % 2 != 0:
        return ValidationResult(False, "Edge flip error: one edge is flipped", UNSOLVABLE)
    if _parity(corner_perm) != _parity(edge_perm):
        return ValidationResult(
            False, "Parity error: two pieces would need to be swapped", UNSOLVABLE
        )

    return ValidationResult(True)


def check_facelet(facelet: object) -> ValidationResult:
    """Validate a facelet string, reporting why it fails.

    ``check_solvable`` performs the format checks too, so this is an alias kept
    for the clearer name at the call sites.
    """
    return check_solvable(facelet)


def validate_facelet(facelet: object) -> Tuple[bool, Optional[str]]:
    """Convenience wrapper returning ``(ok, error)``."""
    result = check_facelet(facelet)
    return result.ok, result.error


def is_solved(facelet: object) -> bool:
    """True when every face shows one colour and the faces differ.

    Works for any orientation, since a rotated but solved cube still has nine
    identical stickers per face. The distinctness check rejects degenerate
    input such as 54 identical stickers, which is uniform per face but cannot
    be a cube. Used to confirm the solver's own answer before the API reports
    it as a solution.
    """
    if not isinstance(facelet, str) or len(facelet) != NUM_STICKERS:
        return False
    faces = [facelet[i * 9:(i + 1) * 9] for i in range(6)]
    if any(len(set(face)) != 1 for face in faces):
        return False
    return len({face[0] for face in faces}) == 6
