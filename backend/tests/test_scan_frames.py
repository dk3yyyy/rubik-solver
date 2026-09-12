"""Reading a camera frame: what the scanner is allowed to call a sticker.

Regression cover for a scan that failed with "frame 2 should be the red (R) face
but its centre reads as green" while the cube in front of the camera was fine.
The sampler took the bounding box of the largest four-sided contour, and when it
found none it sampled the whole picture, so the nine "stickers" were nine patches
of the room and the scan blamed the cube for them.

Every frame here goes through JPEG, because that is what the browser sends and
what the endpoint decodes. Frames fed in as raw arrays hid a defect once already:
a face tilted 21 degrees was read from a raw array and refused from the JPEG of
the same frame.
"""

import numpy as np
import pytest

import webcam
from helpers import (jpeg_roundtrip, make_face_image, make_frame,
                     make_framed_tiling_frame)
from webcam import (
    GRID_SCALES,
    MIN_INTERNAL_LINES,
    _crop_stats,
    _rotated,
    _square_at,
    _working_frame,
    analyse_face,
    detect_face_colors,
)

# A scrambled face: unlike a solid colour, a crop that lands in the wrong place
# shows up as the wrong letters.
SCRAMBLED = list("URFDLBURF")

# The desk colours are not decoration: wood is close to the orange of the R and
# L stickers, which is what lets a crop that has strayed off the face still read
# as nine plausible colours.
WOOD = (120, 160, 190)
PALE_DESK = (200, 200, 200)


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
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"], result["reason"]
    assert result["colours"] == list("UUUUUUUUU"), result["colours"]


def test_a_frame_with_no_cube_is_refused_rather_than_invented():
    desk = np.full((480, 640, 3), 70, dtype=np.uint8)
    result = analyse_face(jpeg_roundtrip(desk))
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
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"] is False, result["colours"]


def test_a_bright_background_does_not_become_the_face():
    # A window filling the top half of the frame is a big bright rectangle, and
    # reads as nine white stickers. The cube in front of it is the face.
    frame = make_frame(
        SCRAMBLED,
        coverage=0.55,
        quads=[([(30, 20), (610, 20), (610, 250), (30, 250)], (250, 250, 250))],
    )
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]


@pytest.mark.parametrize("angle", [0, 7, 14, 21, 28])
def test_a_tilted_cube_is_still_read(angle):
    # Nobody holds a cube dead square to the camera.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.7, angle=angle))
    result = analyse_face(frame)
    assert result["found"], (angle, result["reason"])
    assert result["colours"] == SCRAMBLED, (angle, result["colours"])


@pytest.mark.parametrize("coverage", [0.35, 0.5, 0.7, 0.9])
def test_the_cube_is_read_however_much_of_the_frame_it_fills(coverage):
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=coverage))
    result = analyse_face(frame)
    assert result["found"], (coverage, result["reason"])
    assert result["colours"] == SCRAMBLED, (coverage, result["colours"])


def test_a_solid_face_is_read_whichever_alignment_wins():
    for letter in "URFDLB":
        result = analyse_face(jpeg_roundtrip(make_frame(letter * 9, coverage=0.6)))
        assert result["found"], (letter, result["reason"])
        assert result["colours"] == [letter] * 9, (letter, result["colours"])


def test_a_face_is_not_read_from_a_sticker_sized_crop():
    # The largest four-sided contour on a real cube is one *sticker*, not the
    # face, because a face has rounded corners. A crop that small was accepted
    # and reported with full confidence, which is how a scan came back with a
    # plausible-looking cube read entirely from one corner.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.6))
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    # All nine stickers of the face, which a one-sticker crop cannot produce.
    assert result["colours"] == SCRAMBLED, result["colours"]


@pytest.mark.parametrize("coverage", [0.3, 0.5])
@pytest.mark.parametrize("angle", [0, 21, 45])
def test_a_cube_against_a_white_wall_is_still_read(coverage, angle):
    # Nine white stickers against a white wall are the same colour as the wall,
    # so a probe that compares colour alone says the pattern carries on into it
    # and the frame is refused. The centre search has always refused these
    # frames; a crop taken from the face's own outline used to be exempt, and
    # applying the check to it without asking for the wall's *structure* took
    # seven real frames off a 160-frame battery. Both edits are in this test:
    # asked for the next cell's boundary, a flat wall is not the next cell.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=coverage, angle=angle,
                                      background=(245, 245, 245)))
    result = analyse_face(frame)
    assert result["found"], (coverage, angle, result["reason"])
    assert result["colours"] == SCRAMBLED, (coverage, angle, result["colours"])


def test_the_quad_probe_asks_for_the_next_cell_boundary_not_only_its_colour():
    # The one thing a quad crop's probe asks for that a window crop's does not,
    # pinned at the probe itself: a tiled surface beyond the crop has the colour
    # *and* the boundary, a wall has only the colour, and the two have to be told
    # apart or the framed tile gets in and the white wall goes out.
    def extends(frame, structure):
        work = webcam._working_frame(frame)
        quad = webcam._quad_list(work)[0]
        cx, cy, side = webcam._quad_rect(quad)
        stats = webcam._crop_stats(webcam.warp_face(work, quad))
        return webcam._pattern_extends(work, cx, cy, side, stats, structure=structure)

    tiled = jpeg_roundtrip(make_framed_tiling_frame())
    assert extends(tiled, structure=False) >= 1, "the tiling beyond the crop carries on"
    assert extends(tiled, structure=True) >= 1, "and it carries on with its own lines"

    wall = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.5, background=(245, 245, 245)))
    assert extends(wall, structure=False) >= 1, "colour alone says the wall carries on"
    assert extends(wall, structure=True) == 0, "the wall is flat, so it does not"


@pytest.mark.parametrize("coverage", [0.5, 0.6, 0.7, 0.8, 0.9])
def test_stickers_that_touch_are_still_read_as_a_face(coverage):
    # A cube whose stickers have no plastic visible between them: nine flat
    # cells with nothing to separate them. The old sampler read one of those
    # cells as the whole face ("U U U U U U U U U" for a scrambled face).
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=coverage, gap=0))
    result = analyse_face(frame)
    assert result["found"], (coverage, result["reason"])
    assert result["colours"] == SCRAMBLED, (coverage, result["colours"])


@pytest.mark.parametrize("dx", [-160, -120, -80, -40, 40, 80, 120])
def test_a_cube_held_off_centre_is_read_where_it_is(dx):
    # The sampler looked only at the middle of the frame, so a cube held to one
    # side was refused, or worse read from whatever the middle happened to be.
    frame = make_frame(SCRAMBLED, coverage=0.6, centre=(320 + dx, 240))
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"], (dx, result["reason"])
    assert result["colours"] == SCRAMBLED, (dx, result["colours"])


@pytest.mark.parametrize("cov", [0.25, 0.3])
def test_a_cube_at_arm_s_length_on_a_bright_desk_is_read(cov):
    # The face outline is visible against a bright desk, and the face is small:
    # this is the frame the pre-fix code read sticker for sticker and the first
    # version of the centre search answered with the desk.
    frame = make_frame(SCRAMBLED, coverage=cov, background=PALE_DESK)
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"], (cov, result["reason"])
    assert result["colours"] == SCRAMBLED, (cov, result["colours"])


@pytest.mark.parametrize("dx", [60, 100, 140])
def test_a_cube_on_a_wooden_desk_is_read_as_the_face_not_the_desk(dx):
    # Wood is the colour of the R and L stickers, so a crop that runs one row
    # too high reads its top row of desk as three more stickers and the face
    # below it still reads, which is a plausible-looking wrong answer rather
    # than a refusal. The continuation check exists to catch exactly that, and
    # it was skipping its own probe: a crop pushed up against the frame edge
    # leaves a band too thin for the share test the probe used, so the row of
    # desk inside the crop was never questioned.
    frame = make_frame(SCRAMBLED, coverage=0.6, background=WOOD, centre=(320 + dx, 240))
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"], (dx, result["reason"])
    assert result["colours"] == SCRAMBLED, (dx, result["colours"])


@pytest.mark.parametrize("angle", [39, 40, 45])
def test_a_cube_tilted_past_the_search_window_is_never_read_wrong(angle):
    # Past the range of rotations the search tries, the answer has to be "no"
    # (or the right answer), never nine confident wrong stickers.
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
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=coverage))
    result = analyse_face(frame)
    if result["found"]:
        assert result["colours"] == SCRAMBLED, (coverage, result["colours"])


def test_one_sticker_and_its_plastic_ring_is_not_read_as_a_whole_face():
    # A face filling 82% of the frame, tilted 21 degrees, on a cube whose
    # stickers have plastic on all four of their sides. The sampler answered
    # "L L L L L L L L L" at confidence 1.0 from a 134 px window: one sticker of
    # the middle of the face plus the plastic ring around it. All nine of that
    # window's cells sat inside the one sticker, and the ring's outer edge
    # crossed the ends of the four boundary strips, so the boundary count read
    # 4 of 4 and the flatness check 9 of 9. Nine Ls is a plausible cube state,
    # which is what made it dangerous: the frame has to be read from the face
    # or refused, never from one of its stickers.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.82, angle=21, ring=True))
    result = analyse_face(frame)
    assert result["found"], result["reason"]
    assert result["colours"] == SCRAMBLED, result["colours"]
    # The window that used to win covered a quarter of the frame; the face
    # covers most of it.
    assert result["coverage"] > 0.5, result["coverage"]


def test_the_plastic_ring_around_one_sticker_is_not_a_sticker_boundary():
    # Where that is enforced: `_internal_lines` in backend/webcam.py counts a
    # boundary when the plastic covers LINE_DARK_SHARE of the crossing strip,
    # not when the strip's darkest pixel is the plastic. The ring *around* a
    # sticker crosses the end of every strip without running across any of
    # them, so a crop of one sticker plus its ring - which reads nine identical
    # letters, because all nine cells are inside the one sticker - has no
    # boundaries between its cells and cannot be a face, however plausible its
    # nine letters look.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.82, angle=21, ring=True))
    work = _working_frame(frame)
    short = float(min(work.shape[:2]))
    # The window the search used to accept: the smallest square of its own
    # coarse grid, sampled at the small rotations it tries around the sticker
    # it found. The face is centred on the frame, so that window sits on the
    # face's middle sticker - SCRAMBLED's middle sticker is L - and all nine of
    # its cell samples land inside that one sticker. If a crop like this is ever
    # read as a face, the nine Ls that come back are one sticker nine times.
    for angle in (20.4, 21.0, 21.4):
        crop = _square_at(_rotated(work, angle), work.shape[1] / 2.0, work.shape[0] / 2.0,
                          short * GRID_SCALES[0])
        assert crop is not None
        stats = _crop_stats(crop)
        assert stats["colours"] == ["L"] * 9, (angle, stats["colours"])
        assert stats["lines"] < MIN_INTERNAL_LINES, (
            f"at {angle} degrees the ring around one sticker counted as "
            f"{stats['lines']} boundaries")


@pytest.mark.parametrize("gap, coverage, angle", [
    (4, 0.80, 18), (4, 0.80, 21), (4, 0.82, 18),
    (5, 0.80, 21), (5, 0.82, 18), (5, 0.82, 24),
])
def test_a_tilted_face_is_read_from_the_face_not_from_one_of_its_stickers(gap, coverage, angle):
    # The same defect a size or a degree either side of the frame above: every
    # one of these came back as nine identical letters before, with the plastic
    # ring landing on the crop's own thirds. A neighbour of it (a 4 px ring at
    # coverage 0.82) still misreads, from a magnified crop of part of the face
    # rather than from one sticker; that is a separate defect, not this one.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=coverage, angle=angle,
                                      gap=gap, ring=True))
    result = analyse_face(frame)
    assert result["found"], (gap, coverage, angle, result["reason"])
    assert result["colours"] == SCRAMBLED, (gap, coverage, angle, result["colours"])


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


def _probes_aimed_at_quads(frame):
    """Run one frame, recording where the continuation check looked.

    The check only sees the crop's position and size in the frame, so what it
    was pointed at is the whole of its evidence for a quad crop: this returns
    the probes that were aimed at a detected quadrilateral's own rect, and
    whether each one asked for the band's structure as well as its colour.
    """
    work = webcam._working_frame(frame)
    rects = [webcam._quad_rect(quad) for quad in webcam._quad_list(work)]
    probes = []
    real = webcam._pattern_extends

    def recorder(probe_frame, cx, cy, side, stats, **kwargs):
        probes.append((cx, cy, side, bool(kwargs.get("structure"))))
        return real(probe_frame, cx, cy, side, stats, **kwargs)

    webcam._pattern_extends = recorder
    try:
        result = analyse_face(frame)
    finally:
        webcam._pattern_extends = real

    hits = [probe for probe in probes
            if any(abs(probe[0] - rect[0]) < 2 and abs(probe[1] - rect[1]) < 2
                   and abs(probe[2] - rect[2]) < 3 for rect in rects)]
    return result, rects, hits


@pytest.mark.parametrize(
    "bx, by, thickness",
    [(240, 160, 3), (200, 120, 3), (100, 60, 4)],
)
def test_a_rectangle_drawn_round_a_tiled_block_is_not_a_face(bx, by, thickness):
    # The tiling is refused on its own (it is in the scenery sweep above); the
    # same tiling with anything four-sided drawn round a 3x3 block of it used to
    # come back as nine confident white stickers, because the crop read from the
    # quadrilateral skipped the continuation check that refuses the tiling. The
    # pattern carries on past the rectangle, which is the whole point of the
    # probe.
    frame = jpeg_roundtrip(make_framed_tiling_frame(block_origin=(bx, by),
                                                    thickness=thickness))
    result = analyse_face(frame)
    assert result["found"] is False, (bx, by, thickness, result["colours"])
    assert result["colours"] == [None] * 9
    assert result["confidence"] == 0.0


def test_a_crop_read_from_a_quad_faces_the_continuation_check():
    # A detected quadrilateral says where the crop is, not that what it holds is
    # a face: the probe has to be aimed at the quadrilateral's own rect in the
    # frame, like a window's is at the window. Without that, the framed tiling
    # above is accepted with the check never called.
    frame = jpeg_roundtrip(make_framed_tiling_frame())
    result, rects, hits = _probes_aimed_at_quads(frame)
    assert rects, "the frame should give the search a quadrilateral"
    assert result["found"] is False, result["colours"]
    assert hits, ("no probe was aimed at a quadrilateral, so the quad crop skipped "
                  "the continuation check")
    assert any(probe[3] for probe in hits), (
        "the probe on a quadrilateral's rect did not ask for the band's structure")


def test_a_face_read_from_a_quad_is_still_checked_and_still_read():
    # The other half of the same gate: a face held against a pale desk is still
    # read from its own outline, and the read still went through the check, so
    # the fix is not a blanket exemption for quads in either direction.
    frame = jpeg_roundtrip(make_frame(SCRAMBLED, coverage=0.4, background=PALE_DESK))
    result, rects, hits = _probes_aimed_at_quads(frame)
    assert result["found"], result["reason"]
    assert result["source"] == "quad"
    assert result["framed"] is True
    assert result["colours"] == SCRAMBLED
    assert hits, "the quad crop was accepted without the continuation check"
    assert any(probe[3] for probe in hits), (
        "the probe on a quadrilateral's rect did not ask for the band's structure")


@pytest.mark.parametrize(
    "name, frame",
    [
        ("wooden desk", np.full((480, 640, 3), WOOD, dtype=np.uint8)),
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
    # confident white stickers and the scan blamed the cube for them.
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
    frame = make_frame(SCRAMBLED, coverage=0.4, background=PALE_DESK)
    result = analyse_face(jpeg_roundtrip(frame))
    assert result["found"], result["reason"]
    assert result["source"] == "quad", result["source"]
    assert result["framed"] is True
    assert result["colours"] == SCRAMBLED, result["colours"]
