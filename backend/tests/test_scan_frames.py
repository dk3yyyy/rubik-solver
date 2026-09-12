"""Reading a camera frame: what the scanner is allowed to call a sticker.

Regression cover for a scan that failed with "frame 2 should be the red (R) face
but its centre reads as green" while the cube in front of the camera was fine.
The sampler took the bounding box of the largest four-sided contour, and when it
found none it sampled the whole picture, so the nine "stickers" were nine patches
of the room and the scan blamed the cube for them.
"""

import numpy as np
import pytest

from helpers import jpeg_roundtrip, make_face_image, make_frame
from webcam import analyse_face, detect_face_colors

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


@pytest.mark.parametrize("coverage", [0.5, 0.6, 0.7, 0.8, 0.9])
def test_stickers_that_touch_are_still_read_as_a_face(coverage):
    # A cube whose stickers have no plastic visible between them: nine flat
    # cells with nothing to separate them. The old sampler read one of those
    # cells as the whole face ("U U U U U U U U U" for a scrambled face).
    frame = make_frame(SCRAMBLED, coverage=coverage, gap=0)
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]


@pytest.mark.parametrize("dx", [-160, -120, -80, -40, 40, 80, 120])
def test_a_cube_held_off_centre_is_read_where_it_is(dx):
    # The sampler looked only at the middle of the frame, so a cube held to one
    # side was refused, or worse read from whatever the middle happened to be.
    frame = make_frame(SCRAMBLED, coverage=0.6, centre=(320 + dx, 240))
    result = analyse_face(frame)
    assert result["found"], (dx, result["reason"])
    assert result["colours"] == SCRAMBLED, (dx, result["colours"])


@pytest.mark.parametrize("cov", [0.25, 0.3])
def test_a_cube_at_arm_s_length_on_a_bright_desk_is_read(cov):
    # The face outline is visible against a bright desk, and the face is small:
    # this is the frame the pre-fix code read sticker for sticker and the first
    # version of the centre search answered with the desk.
    frame = make_frame(SCRAMBLED, coverage=cov, background=(200, 200, 200))
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]


@pytest.mark.parametrize("angle", [39, 40, 45])
def test_a_cube_tilted_past_the_search_window_is_never_read_wrong(angle):
    # Past the range of rotations the search tries, the answer has to be "no"
    # (or the right answer), never nine confident wrong stickers. JPEG, because
    # that is what the browser sends and what the endpoint decodes.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.7, angle=angle))
    result = analyse_face(frame)
    if result["found"]:
        assert result["colours"] == SCRAMBLED, (angle, result["colours"])


@pytest.mark.parametrize("coverage", [1.05, 1.2, 1.5])
def test_a_cube_too_close_to_read_is_not_turned_into_one_sticker(coverage):
    # The face is bigger than the frame, so no 3x3 of it can be lined up.
    # Reading the middle of one sticker nine times is the failure to avoid, and
    # a crop sitting on a junction between four stickers - nearly half plastic,
    # reading a blend of the four colours - must not outrank the face either.
    # JPEG, because that is what the browser sends and what the endpoint decodes.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=coverage))
    result = analyse_face(frame)
    if result["found"]:
        assert result["colours"] == SCRAMBLED, (coverage, result["colours"])


def _tiled_frame(tile=80, grout=5, colour=(200, 220, 230), frame_size=(480, 640)):
    height, width = frame_size
    img = np.full((height, width, 3), colour, dtype=np.uint8)
    for x in range(0, width, tile):
        img[:, x:x + grout] = (30, 30, 30)
    for y in range(0, height, tile):
        img[y:y + grout, :] = (30, 30, 30)
    return img


def _window_frame(frame_size=(480, 640)):
    height, width = frame_size
    img = np.full((height, width, 3), 240, dtype=np.uint8)
    img[:, 200:210] = (20, 20, 20)
    img[:, 420:430] = (20, 20, 20)
    img[150:160, :] = (20, 20, 20)
    img[310:320, :] = (20, 20, 20)
    return img


@pytest.mark.parametrize(
    "name, frame",
    [
        ("wooden desk", np.full((480, 640, 3), (120, 160, 190), dtype=np.uint8)),
        ("white wall", np.full((480, 640, 3), (245, 245, 245), dtype=np.uint8)),
        ("hand in shot", np.full((480, 640, 3), (140, 160, 200), dtype=np.uint8)),
        ("tiled floor", _tiled_frame()),
        ("window with mullions", _window_frame()),
    ],
)
def test_scenery_that_looks_like_a_face_at_a_glance_is_refused(name, frame):
    # Nine flat cells between dark lines is what a face looks like, and also
    # what a tiled floor, a radiator grille or a window looks like. What a face
    # does not do is carry on: beyond its ninth sticker is the room, not another
    # sticker of the same colour. These frames used to come back as nine
    # confident white stickers and the scan blamed the cube for them. JPEG,
    # because that is what the browser sends and what the endpoint decodes.
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"] is False, (name, result["colours"])
    assert result["colours"] == [None] * 9
    assert result["confidence"] == 0.0


def test_a_cropped_sticker_sheet_is_refused_by_the_frame_reader():
    # A tight crop of one flat colour is not a camera frame: there is no face in
    # it to find - no sticker edges, nothing to say where nine cells would even
    # be - and the sampler says so rather than inventing nine stickers.
    sheet = make_face_image(list("U" * 9))
    result = analyse_face(sheet)
    assert result["found"] is False, result["colours"]
    # The sticker classifier still reads it, because that is what it is for.
    assert detect_face_colors(sheet) == (list("U" * 9), 1.0)


def test_a_detected_face_outline_is_used_and_said_so():
    # A face held against a pale desk has a visible outline. Straightening it by
    # perspective is the most direct reading available, so the result says that
    # is where the nine stickers came from.
    frame = make_frame(SCRAMBLED, coverage=0.4, background=(200, 200, 200))
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["source"] == "quad", result["source"]
    assert result["framed"] is True
    assert result["colours"] == SCRAMBLED, result["colours"]

