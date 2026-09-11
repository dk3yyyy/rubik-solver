"""Rubik's Cube solver engine wrapper."""

# Fallback implementation if rubik_solver is not installed
SOLVER_AVAILABLE = False
try:
    from rubik_solver import Cube, init_solver, solve, scramble as gen_scramble
    SOLVER_AVAILABLE = True
except ImportError:
    pass

def init():
    """Initialize solver (pre-compute tables)."""
    global SOLVER_AVAILABLE
    if SOLVER_AVAILABLE:
        try:
            init_solver()
            return True
        except Exception:
            return False
    return False

def scramble(moves=20):
    """Generate a random scramble."""
    if SOLVER_AVAILABLE:
        return gen_scramble(moves)
    # Fallback: generate random moves manually
    import random
    faces = ['U', 'D', 'L', 'R', 'F', 'B']
    scramble_moves = []
    last_face = None
    for _ in range(moves):
        face = random.choice(faces)
        while face == last_face:
            face = random.choice(faces)
        last_face = face
        modifier = random.choice(['', "'"])
        scramble_moves.append(face + modifier)
    return ' '.join(scramble_moves)

def apply_scramble(scramble_str):
    """Apply a scramble to get the facelet string."""
    if SOLVER_AVAILABLE:
        cube = Cube()
        cube.move(scramble_str)
        return cube.as_string()
    # Fallback: return solved state (can't simulate without library)
    return 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB'

def solve_cube(facelet_str, max_depth=22):
    """Solve a cube from facelet string."""
    if SOLVER_AVAILABLE:
        cube = Cube.from_string(facelet_str)
        return solve(cube, max_depth=max_depth)
    return None

def validate(facelet_str):
    """Validate a facelet string."""
    if SOLVER_AVAILABLE:
        try:
            cube = Cube.from_string(facelet_str)
            result = cube.verify()
            if result is True:
                return True, None
            return False, str(result)
        except Exception as e:
            return False, str(e)
    # Basic validation without library
    if len(facelet_str) != 54:
        return False, "Facelet string must be 54 characters"
    valid_chars = set('URFDLB')
    if not all(c in valid_chars for c in facelet_str):
        return False, "Invalid characters (must be U, R, F, D, L, B)"
    # Check counts
    for c in valid_chars:
        if facelet_str.count(c) != 9:
            return False, f"Face {c} must appear exactly 9 times (found {facelet_str.count(c)})"
    return True, None

def is_available():
    """Check if solver is available."""
    return SOLVER_AVAILABLE
