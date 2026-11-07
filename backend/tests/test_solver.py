"""Solver wrapper: scramble generation, solution, state application."""

import pytest

import solver
from validator import validate_facelet

SOLVED = solver.SOLVED_FACELET


@pytest.fixture(scope="module", autouse=True)
def _solver():
    assert solver.init() is True, "solver tables failed to build"
    yield


def test_random_scramble_is_a_legal_state():
    result = solver.random_scramble()
    assert result is not None
    scramble, state = result
    assert len(scramble.split()) == 20
    assert validate_facelet(state)[0] is True


def test_scramble_reproduces_the_reported_state():
    scramble, state = solver.random_scramble()
    assert solver.apply_moves(SOLVED, scramble) == state


def test_solution_actually_solves():
    _, state = solver.random_scramble()
    moves = solver.solve_facelet(state)
    assert moves, "solver returned no moves for a valid scramble"
    assert solver.apply_moves(state, " ".join(moves)) == SOLVED


def test_solution_is_within_gods_number_bound():
    _, state = solver.random_scramble()
    moves = solver.solve_facelet(state)
    assert len(moves) <= 22


def test_solved_cube_needs_no_moves():
    assert solver.solve_facelet(SOLVED) == []


def test_apply_moves_with_empty_string_is_identity():
    assert solver.apply_moves(SOLVED, "") == SOLVED


def test_scramble_avoids_repeating_a_face():
    for _ in range(5):
        scramble, _ = solver.random_scramble()
        faces = [move[0] for move in scramble.split()]
        assert all(a != b for a, b in zip(faces, faces[1:]))


def _relabel(facelet: str) -> str:
    """The same cube with its colours renamed, e.g. as a whole-cube rotation."""
    return facelet.translate(str.maketrans("URFDLB", "RFD" + "LB" + "U"))


def test_a_relabelled_solved_cube_is_already_solved():
    # The validator accepts a cube whose centres carry a different colour
    # scheme, so the solver has to read it the same way. The library parses
    # facelets by their literal letters, so without relabelling it saw a
    # scrambled cube and returned a sequence that solved nothing.
    assert solver.solve_facelet(_relabel(SOLVED)) == []


def test_a_relabelled_scramble_solves_back_to_solved():
    from validator import is_solved

    _, state = solver.random_scramble()
    relabelled = _relabel(state)
    assert validate_facelet(relabelled)[0] is True

    moves = solver.solve_facelet(relabelled)
    assert moves, "solver returned no moves for a valid relabelled scramble"
    assert is_solved(solver.apply_moves(relabelled, " ".join(moves)))


def test_init_is_retried_after_a_transient_table_build_failure(monkeypatch):
    # A failed build is often transient (memory pressure during a deploy
    # start). Before, only the startup call ever ran, so one failure left every
    # solver endpoint answering 503 until the process was restarted.
    import time

    calls = []
    real_init_solver = solver.init_solver

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("tables failed to build")
        return real_init_solver()

    monkeypatch.setattr(solver, "init_solver", flaky)
    monkeypatch.setattr(solver, "_solver_ready", False)
    monkeypatch.setattr(solver, "_last_failure", None, raising=False)

    assert solver.init() is False
    # The cooldown stops a permanently broken build from being retried on
    # every request; after it elapses the retry is allowed.
    assert solver.init() is False
    assert len(calls) == 1

    monkeypatch.setattr(solver, "_last_failure", time.monotonic() - getattr(solver, "_RETRY_AFTER_FAILURE", 5.0) - 1, raising=False)
    assert solver.init() is True
    assert len(calls) == 2
