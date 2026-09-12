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
