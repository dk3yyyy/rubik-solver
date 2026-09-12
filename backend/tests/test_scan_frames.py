"""Reading a camera frame: what the scanner is allowed to call a sticker.

Regression cover for a scan that failed with "frame 2 should be the red (R) face
but its centre reads as green" while the cube in front of the camera was fine.
The sampler took the bounding box of the largest four-sided contour, and when it
found none it sampled the whole picture, so the nine "stickers" were nine patches
of the room and the scan blamed the cube for them.
"""

import numpy as np
import pytest

from helpers import make_frame
from webcam import analyse_face

# A scrambled face: unlike a solid colour, a crop that lands in the wrong place
# shows up as the wrong letters.
SCRAMBLED = list("URFDLBURF")


def test_the_frame_is_read_from_the_middle_not_the_whole_picture():
    # A green band across the top of the frame, a red-faced cube held level in
    # the middle. Sampling the whole picture put the top row of "stickers" in
    # the green band, which is how a centre sticker came back as the wrong
    # colour on a cube that was held correctly.
    frame = make_frame(
        list("UUUUUUUUU"),
        coverage=0.5,
        quads=[([(0, 0), (640, 0), (640, 150), (0, 150)], (0, 200, 0))],
    )
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == list("UUUUUUUUU"), result["colours"]


def test_a_frame_with_no_cube_is_refused_rather_than_invented():
    desk = np.full((480, 640, 3), 70, dtype=np.uint8)
    result = analyse_face(desk)
    assert result["found"] is False
    assert result["colours"] == [None] * 9
    assert "could be read" in result["reason"]


def test_a_busy_room_is_refused_rather_than_read_as_stickers():
    # Registers, a keyboard, a mug: plenty of edges but no cube face. This is
    # the frame the scanner used to turn into nine confident stickers.
    frame = np.full((480, 640, 3), 70, dtype=np.uint8)
    for x in range(0, 640, 40):
        frame[:, x:x + 12] = (90, 80, 60)
    for y in range(0, 480, 60):
        frame[y:y + 20, :] = (60, 60, 60)
    result = analyse_face(frame)
    assert result["found"] is False, result["colours"]


def test_a_bright_background_does_not_become_the_face():
    # A window filling the top half of the frame is a big bright rectangle, and
    # reads as nine white stickers. The cube in front of it is the face.
    frame = make_frame(
        SCRAMBLED,
        coverage=0.55,
        quads=[([(30, 20), (610, 20), (610, 250), (30, 250)], (250, 250, 250))],
    )
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]


@pytest.mark.parametrize("angle", [0, 7, 14, 21, 28])
def test_a_tilted_cube_is_still_read(angle):
    # Nobody holds a cube dead square to the camera.
    frame = make_frame(SCRAMBLED, coverage=0.7, angle=angle)
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]


@pytest.mark.parametrize("coverage", [0.35, 0.5, 0.7, 0.9])
def test_the_cube_is_read_however_much_of_the_frame_it_fills(coverage):
    frame = make_frame(SCRAMBLED, coverage=coverage)
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]


def test_a_solid_face_is_read_whichever_alignment_wins():
    for letter in "URFDLB":
        result = analyse_face(make_frame(letter * 9, coverage=0.6))
        assert result["found"], (letter, result["reason"])
        assert result["colours"] == [letter] * 9, (letter, result["colours"])


def test_a_face_is_not_read_from_a_sticker_sized_crop():
    # The largest four-sided contour on a real cube is one *sticker*, not the
    # face, because a face has rounded corners. A crop that small was accepted
    # and reported with full confidence, which is how a scan came back with a
    # plausible-looking cube read entirely from one corner.
    frame = make_frame(SCRAMBLED, coverage=0.6)
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    # All nine stickers of the face, which a one-sticker crop cannot produce.
    assert result["colours"] == SCRAMBLED, result["colours"]
