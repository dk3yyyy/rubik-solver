"""Facelet validation: format errors vs mathematically impossible cubes."""

import pytest

from validator import (
    FORMAT,
    UNSOLVABLE,
    check_facelet,
    check_format,
    check_solvable,
    validate_facelet,
)

SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


def test_solved_state_is_valid():
    assert validate_facelet(SOLVED) == (True, None)


def test_lowercase_and_whitespace_are_accepted():
    assert validate_facelet(f"  {SOLVED.lower()}  ")[0] is True


def test_rotated_cube_is_valid():
    # Relabelling every colour describes the same cube seen from another side;
    # the centres define the orientation, so this must stay valid.
    relabel = str.maketrans("URFDLB", "RFD" + "LB" + "U")
    assert validate_facelet(SOLVED.translate(relabel))[0] is True


def test_library_scrambles_are_valid():
    from rubik_solver import Cube, scramble

    for _ in range(5):
        cube = Cube()
        cube.move(scramble())
        assert validate_facelet(cube.as_string())[0] is True


@pytest.mark.parametrize(
    "facelet, fragment",
    [
        ("U" * 54, "appears 54 times"),
        ("UUU", "must be 54 characters"),
        ("X" * 54, "Invalid characters"),
        (SOLVED[:53] + "R", "appears 10 times"),
    ],
)
def test_format_errors_are_reported(facelet, fragment):
    result = check_format(facelet)
    assert result.ok is False
    assert result.kind == FORMAT
    assert fragment in (result.error or "")


def test_duplicate_centres_are_a_format_error():
    # Two centres the same colour while the per-colour counts stay at nine:
    # turn the R centre into U and move a U sticker onto the R face.
    broken = list(SOLVED)
    broken[13] = "U"  # R centre becomes U
    broken[0] = "R"   # keep both colour counts at nine
    result = check_format("".join(broken))
    assert result.ok is False
    assert result.kind == FORMAT
    assert "centre" in (result.error or "")


def test_swapped_stickers_are_unsolvable():
    # The library's own Cube.verify() accepts this; ours must not.
    broken = list(SOLVED)
    broken[0], broken[9] = broken[9], broken[0]
    result = check_solvable("".join(broken))
    assert result.ok is False
    assert result.kind == UNSOLVABLE


def test_corner_twist_is_unsolvable():
    broken = list(SOLVED)
    broken[8], broken[9], broken[20] = broken[20], broken[8], broken[9]
    result = check_facelet("".join(broken))
    assert result.ok is False
    assert "Corner twist" in (result.error or "")


def test_edge_flip_is_unsolvable():
    broken = list(SOLVED)
    broken[5], broken[10] = broken[10], broken[5]
    result = check_facelet("".join(broken))
    assert result.ok is False
    assert "Edge flip" in (result.error or "")


def test_parity_mismatch_is_unsolvable():
    # Swap two whole corner pieces: corner parity becomes odd while the edges
    # stay even, which no legal cube can have.
    broken = list(SOLVED)
    corner_a = [8, 9, 20]
    corner_b = [6, 18, 38]
    for a, b in zip(corner_a, corner_b):
        broken[a], broken[b] = broken[b], broken[a]
    result = check_facelet("".join(broken))
    assert result.ok is False
    assert result.kind == UNSOLVABLE
    assert "Parity" in (result.error or "")


def test_non_string_input():
    result = check_format(None)
    assert result.ok is False
    assert result.kind == FORMAT


@pytest.mark.parametrize("value", ["ABC", "", None, 123, "X" * 54])
def test_check_solvable_never_raises_on_bad_input(value):
    # Regression: calling the solvability check directly used to raise
    # IndexError for short input and AttributeError for non-strings.
    result = check_solvable(value)
    assert result.ok is False
    assert result.error
