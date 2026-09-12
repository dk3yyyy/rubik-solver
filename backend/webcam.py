"""Colour classification for webcam cube scanning.

Each cube face is sampled as a 3x3 grid of stickers, the average HSV of every
sticker is classified against the six cube colours, and the result is returned
as facelet letters.

The previous implementation defaulted every unrecognised sticker to white
(``'U'``), so a miscalibrated or badly lit scan silently produced a plausible
but wrong cube state. Unmatched stickers are reported as ``None`` with a
reduced confidence score so the caller can reject the scan instead of guessing.

Reading a *frame* is a separate problem from classifying a *sticker*, and it is
the one that produced "frame 2 should be the red (R) face but its centre reads
as green" on a cube that was held correctly. The sampler used to take the
bounding box of the largest four-sided contour and, finding none, fall back to
the whole picture, so the nine "stickers" were patches of wall, desk and shirt
and the scan blamed the cube for them. This module now searches the frame for a
crop that actually looks like a cube face and refuses the frame when there is
none, rather than turning whatever is in front of the camera into nine
confident stickers.
"""

from typing import List, Optional, Sequence, Tuple, Union

import cv2
import numpy as np

Image = Union[str, bytes, bytearray, np.ndarray]

# Hue windows. OpenCV hue runs 0-179 (half-degrees), not 0-360, so these bands
# are the usual cube-sticker windows in that scale. Saturation/value gates
# reject washed out or very dark pixels that would otherwise land in a
# neighbouring band.
RED_HUES = ((0, 5), (170, 179))
ORANGE_HUES = ((6, 20),)
YELLOW_HUES = ((21, 35),)
GREEN_HUES = ((36, 85),)
BLUE_HUES = ((86, 130),)

MIN_SATURATION = 60
MIN_VALUE = 60
WHITE_MAX_SATURATION = 60
WHITE_MIN_VALUE = 150
DARK_VALUE = 40

# ---------------------------------------------------------------------------
# What a frame has to show before nine samples may be called stickers.
#
# A scan frame is a room with a cube in it, not a cropped sticker sheet. Two
# things have to be true:
#
#   * all nine cells read as a cube colour, and
#   * the crop shows the 3x3 *structure* of a face: the boundaries between the
#     stickers (near-black plastic, or a colour change between neighbouring
#     stickers) are visible at the thirds of the crop.
#
# The second rule is what a patch of wall, desk, shirt or window cannot fake,
# and it is also what stops a crop taken from *inside* one large sticker from
# being read as nine stickers: nine flat cells with no boundaries between them
# are one sticker, not a face.
#
# The search itself is a coarse sweep of positions and sizes over the middle of
# the frame, then a fine sweep of angles around the best few positions. The
# old sampler looked only at the bounding box of a contour and then, failing
# that, at the whole picture; a cube held a little off centre, at arm's length,
# or filling the frame was read from the wrong pixels entirely.
WORK_MIN_SIDE = 480
# The live overlay polls twice a second, so it asks the same sampler about a
# frame this size on the short side instead of the full one.
PREVIEW_MIN_SIDE = 240
# Every candidate crop is resampled to this before it is measured, so one
# measurement costs the same whatever the frame size and the cell interior is
# always the same number of pixels.
GRID_SAMPLE = 96
# Fractions of the shorter frame side, away from the middle of the frame. The
# coarse sweep only has to find roughly where the face is: the detected
# quadrilaterals already say where the cube is, and the fine sweep moves a
# fraction of a cell at a time from there.
GRID_POSITION_OFFSETS = (-0.30, -0.15, 0.0, 0.15, 0.30)
GRID_SCALES = (0.28, 0.36, 0.46, 0.58, 0.72, 0.88)
# Rotations tried around a coarse hit, in degrees. A detected quadrilateral's own
# rotation is used as the centre of this range, and in practice it carries the
# tilt on its own: on the 85-frame battery this range and an empty range give the
# same verdicts. It stays as a fallback for a face tilted with no usable outline
# in view, where the sticker rotation is all there is to go on, and it is kept
# narrow because it is paid at every seed position.
FINE_ANGLES = (-14.0, -7.0, 0.0, 7.0, 14.0)
# A coarse hit is refined at these size steps and at every angle, and by moving
# the crop a fraction of a cell, because the difference between reading nine
# stickers and reading nine blends of two stickers either side is a fifth of a
# cell of position.
FINE_SCALE_STEPS = (0.92, 1.0, 1.08)
FINE_NUDGES = (-0.25, 0.0, 0.25)
FINE_NUDGE_ANGLES = (-7.0, 0.0, 7.0)
FINE_NUDGE_SEEDS = 2
FINE_SEEDS = 4
# How many crops that already read as nine stickers are put through the
# structural gates before the frame is called a frame with no face in it. The
# gates cost several extra measurements each, and a busy frame with no cube in
# it is the worst case: it has many candidate crops and none of them is a face.
ACCEPT_SCAN_MAX = 40
# A detected four-sided contour is a candidate crop in its own right, as long
# as it is plausibly face-sized, and it is also a hint about how the cube is
# rotated. Quadrilaterals smaller than this share of the frame are stickers or
# furniture, not the face.
MIN_QUAD_AREA = 0.0015
QUAD_SEEDS_MAX = 3
QUAD_INSETS = (1.0, 0.94, 1.06)
# How much of a candidate crop's interior has to be uniform for its cells to
# count as flat stickers, and how many of the four internal sticker boundaries
# have to be visible before the crop may be called a face.
FLAT_SPREAD_MAX = 40
MIN_INTERNAL_LINES = 3
LINE_DARK_DROP = 22.0
LINE_COLOUR_GAP = 38.0
# Sticker gaps are near-black plastic. How much of a face crop they cover is
# roughly the same for any cube - the plastic lines between nine stickers - so
# the score rewards a crop that looks like that and penalises one that does not:
# a crop with no plastic at all has strayed onto a plain desk, and a crop on the
# junction between four stickers (nearly half plastic, reading a blend of four
# colours) is not a face either.
GAP_MAX_VALUE = 60
GAP_SHARE_TYPICAL = 0.12
# Size a detected quadrilateral is straightened to. Bigger than GRID_SAMPLE so
# the perspective warp keeps the sticker edges, which the measurement then
# resamples away cleanly instead of aliasing.
FACE_SAMPLE_SIZE = 240


def _to_bgr(image: Image) -> Optional[np.ndarray]:
    """Accept a path, raw encoded bytes, or an already decoded BGR array."""
    if isinstance(image, np.ndarray):
        return image
    if isinstance(image, (bytes, bytearray)):
        buffer = np.frombuffer(bytes(image), dtype=np.uint8)
        return cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    return cv2.imread(image)


def _in_ranges(hue: int, ranges: Tuple[Tuple[int, int], ...]) -> bool:
    return any(low <= hue <= high for low, high in ranges)


def classify_hsv(hsv_value: np.ndarray) -> Optional[str]:
    """Map an average HSV triple to a facelet letter, or ``None`` if unclear."""
    h, s, v = float(hsv_value[0]), float(hsv_value[1]), float(hsv_value[2])

    if v < DARK_VALUE:
        return None
    if s < WHITE_MAX_SATURATION and v > WHITE_MIN_VALUE:
        return "U"
    if s < MIN_SATURATION or v < MIN_VALUE:
        # Not saturated enough for a coloured face and not bright enough for
        # white: the sticker is ambiguous, so say so instead of guessing.
        return None

    hue = int(round(h))
    if _in_ranges(hue, RED_HUES):
        return "R"
    if _in_ranges(hue, ORANGE_HUES):
        return "L"
    if _in_ranges(hue, YELLOW_HUES):
        return "D"
    if _in_ranges(hue, GREEN_HUES):
        return "F"
    if _in_ranges(hue, BLUE_HUES):
        return "B"
    return None


# --------------------------------------------------------------- candidates ---


def _working_frame(img: np.ndarray) -> np.ndarray:
    """The frame the search runs on.

    Large frames are scaled down first: the search asks hundreds of questions of
    the frame, and at 1080p asking them of full resolution pixels cost more than
    a second per frame. A face that fills even a quarter of a 1080p frame still
    has plenty of pixels at 480 on the short side, and every candidate crop is
    measured after being resampled to a fixed size anyway.
    """
    height, width = img.shape[:2]
    short = min(height, width)
    if short <= WORK_MIN_SIDE:
        return img
    factor = WORK_MIN_SIDE / float(short)
    return cv2.resize(
        img, (max(8, int(round(width * factor))), max(8, int(round(height * factor)))),
        interpolation=cv2.INTER_AREA,
    )


def _square_at(img: np.ndarray, cx: float, cy: float, side: float) -> Optional[np.ndarray]:
    """The square window of ``side`` pixels centred on ``(cx, cy)``."""
    height, width = img.shape[:2]
    side = int(round(min(max(8.0, side), float(min(height, width)))))
    left = int(round(cx - side / 2.0))
    top = int(round(cy - side / 2.0))
    left = max(0, min(left, width - side))
    top = max(0, min(top, height - side))
    crop = img[top:top + side, left:left + side]
    return crop if crop.size else None


def _rotated(img: np.ndarray, angle: float) -> np.ndarray:
    """Rotate about the centre, keeping the frame size."""
    if not angle:
        return img
    height, width = img.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), angle, 1.0)
    return cv2.warpAffine(
        img, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


def _rotated_offset(dx: float, dy: float, angle: float) -> Tuple[float, float]:
    """Where frame-centre-relative ``(dx, dy)`` lands once the frame is rotated.

    Sampling a square window out of a frame that has been rotated by ``angle``
    reads that window at ``angle``, which is how the search tries a cube that is
    not held square without rotating every crop separately.
    """
    if not angle:
        return dx, dy
    radians = np.deg2rad(angle)
    cos, sin = float(np.cos(radians)), float(np.sin(radians))
    return cos * dx + sin * dy, -sin * dx + cos * dy


def _internal_lines(bgr: np.ndarray, value: np.ndarray, means: np.ndarray,
                    spread: np.ndarray) -> int:
    """How many of the four internal sticker boundaries are visible.

    A real face crop has a boundary at each third: the plastic between stickers,
    or simply a different colour either side. Three cells sit on either side of
    each line, so a line counts when at least two of its three crossings show
    one of those two things. Both cells at a crossing have to be uniform for it
    to count: a cell that is itself a mixture is a sign the crop is misaligned,
    and then "the pixels either side differ" says nothing about the face.
    """
    cell = GRID_SAMPLE // 3
    pad = cell // 4
    cell_v = (value.reshape(3, cell, 3, cell)[:, pad:cell - pad, :, pad:cell - pad]
              .transpose(0, 2, 1, 3).reshape(9, -1).mean(axis=1))
    uniform = spread < FLAT_SPREAD_MAX

    lines = 0
    for vertical in (True, False):
        for line in (1, 2):
            hits = 0
            for k in range(3):
                if vertical:
                    pos = line * cell
                    strip = value[k * cell + pad:k * cell + cell - pad, max(0, pos - 2):pos + 3]
                    left, right = means[k * 3 + line - 1], means[k * 3 + line]
                    left_v, right_v = cell_v[k * 3 + line - 1], cell_v[k * 3 + line]
                    left_flat, right_flat = uniform[k * 3 + line - 1], uniform[k * 3 + line]
                else:
                    pos = line * cell
                    strip = value[max(0, pos - 2):pos + 3, k * cell + pad:k * cell + cell - pad]
                    left, right = means[(line - 1) * 3 + k], means[line * 3 + k]
                    left_v, right_v = cell_v[(line - 1) * 3 + k], cell_v[line * 3 + k]
                    left_flat, right_flat = uniform[(line - 1) * 3 + k], uniform[line * 3 + k]
                if strip.size == 0 or not (left_flat and right_flat):
                    continue
                darker = float(strip.min()) <= min(left_v, right_v) - LINE_DARK_DROP
                changed = float(np.abs(left - right).max()) >= LINE_COLOUR_GAP
                if darker or changed:
                    hits += 1
            if hits >= 2:
                lines += 1
    return lines



def _crop_stats(crop: np.ndarray, lines: bool = True) -> dict:
    """What nine cells of this crop look like.

    ``matched`` readable stickers, ``flat`` cells that are uniform inside,
    ``lines`` of the four internal sticker boundaries that are visible, and
    ``gaps`` as the share of near-black plastic. The boundary check is the
    expensive one, and the coarse sweep only has to *find* the face, so it can
    be skipped there.
    """
    small = cv2.resize(crop, (GRID_SAMPLE, GRID_SAMPLE), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    cell = GRID_SAMPLE // 3
    pad = cell // 4
    inner = cell - 2 * pad

    # Slice each cell's interior in the natural (row, col) layout, then group by
    # cell so the nine interiors come out in reading order.
    blocks = small.reshape(3, cell, 3, cell, 3)[:, pad:cell - pad, :, pad:cell - pad, :]
    cells = blocks.transpose(0, 2, 1, 3, 4).reshape(9, inner, inner, 3)
    means = cells.reshape(9, -1, 3).mean(axis=1)
    quarters = cells.reshape(9, 2, inner // 2, 2, inner // 2, 3).mean(axis=(2, 4))
    spread = np.abs(quarters - means[:, None, None, :]).max(axis=(1, 2, 3))
    flat = int(np.count_nonzero(spread < FLAT_SPREAD_MAX))


    hsv_means = cv2.cvtColor(means.reshape(1, 9, 3).astype(np.uint8), cv2.COLOR_BGR2HSV).reshape(9, 3)
    colours = [classify_hsv(row) for row in hsv_means]
    matched = sum(1 for colour in colours if colour is not None)

    value = hsv[:, :, 2]
    gaps = float(np.count_nonzero(value < GAP_MAX_VALUE)) / max(1, value.size)

    return {
        "matched": matched,
        "colours": colours,
        "means": means,
        "flat": flat,
        "lines": _internal_lines(small, value, means, spread) if lines else 0,
        "gaps": round(gaps, 3),
    }



# ------------------------------------------------------------------ quads -----


def _order_quad(quad: np.ndarray) -> np.ndarray:
    """Corners as top-left, top-right, bottom-right, bottom-left."""
    points = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    ordered = np.zeros((4, 2), dtype=np.float32)
    totals = points.sum(axis=1)
    spans = np.diff(points, axis=1).ravel()
    ordered[0] = points[int(np.argmin(totals))]
    ordered[2] = points[int(np.argmax(totals))]
    ordered[1] = points[int(np.argmin(spans))]
    ordered[3] = points[int(np.argmax(spans))]
    return ordered


def warp_face(img: np.ndarray, quad: np.ndarray, size: int = FACE_SAMPLE_SIZE) -> np.ndarray:
    """Straighten a detected face to a square so the 3x3 walk lines up."""
    source = _order_quad(quad)
    target = np.array(
        [[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]], dtype=np.float32
    )
    matrix = cv2.getPerspectiveTransform(source, target)
    return cv2.warpPerspective(img, matrix, (size, size))


def _quad_list(img: np.ndarray, limit: int = QUAD_SEEDS_MAX) -> List[np.ndarray]:
    """Plausible four-sided contours, largest first.

    Corners rather than a bounding box: a face photographed at an angle is a
    quadrilateral, and its bounding box clips the corners off the 3x3 grid that
    is walked afterwards. A cube seen corner-on outlines as a hexagon and is
    deliberately not returned here.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    height, width = img.shape[:2]
    frame_area = float(max(1, height * width))
    found: List[Tuple[float, np.ndarray]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area / frame_area < MIN_QUAD_AREA or area <= 1000:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.1 * peri, True)
        if len(approx) != 4:
            continue
        box = cv2.boundingRect(approx)
        if box[2] <= 0 or box[3] <= 0:
            continue
        aspect = box[2] / float(box[3])
        if not 0.35 <= aspect <= 2.8:
            continue
        found.append((area, approx))
    found.sort(key=lambda item: item[0], reverse=True)
    return [quad for _, quad in found[:limit]]


def _quad_candidates(img: np.ndarray) -> Optional[np.ndarray]:
    """The corner points of the largest plausible four-sided contour, or ``None``."""
    quads = _quad_list(img, limit=1)
    return quads[0] if quads else None


def _inset_quad(quad: np.ndarray, factor: float) -> np.ndarray:
    """The same quadrilateral, shrunk or grown about its centre."""
    points = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    centre = points.mean(axis=0)
    return (centre + (points - centre) * factor).astype(np.float32)


def _quad_angle(quad: np.ndarray) -> float:
    """How far the quadrilateral is rotated, in degrees."""
    ordered = _order_quad(quad)
    top = ordered[1] - ordered[0]
    return float(np.degrees(np.arctan2(top[1], top[0])))


# ------------------------------------------------------------------- search ---


def _read_is_stable(crop: np.ndarray, colours: List[Optional[str]]) -> bool:
    """Whether the same nine stickers come back when the grid moves a little.

    A crop that sits on the stickers reads the same nine colours when the
    sampling grid shifts by a sixth of a cell, because the samples stay inside
    the stickers. A crop that is half a sticker out does not: its cells are
    part sticker and part neighbour, and moving the grid changes the answer.
    This is the check that separates "nine stickers" from "nine plausible
    colours", and it is why a frame that nothing lines up in comes back as a
    frame problem instead of a cube.
    """
    height, width = crop.shape[:2]
    if height < 12 or width < 12:
        return False
    step = max(2, min(height, width) // 18)
    for dy, dx in ((step, 0), (-step, 0), (0, step), (0, -step)):
        top = max(0, dy)
        left = max(0, dx)
        bottom = min(height, height + dy)
        right = min(width, width + dx)
        variant = crop[top:bottom, left:right]
        if variant.size == 0:
            continue
        stats = _crop_stats(variant, lines=False)
        if stats["colours"] != colours:
            return False
    # A few degrees either way as well: a crop sitting on the stickers keeps its
    # nine colours through a small rotation, a crop that is a third of a sticker
    # out to one side does not.
    for angle in (-4.0, 4.0):
        stats = _crop_stats(_rotated(crop, angle), lines=False)
        if stats["colours"] != colours:
            return False
    return True


# A probe band that is mostly off the edge of the frame cannot say anything. The
# test used to be a 30% share of the band, which quietly skipped the case this
# check exists for: a crop pushed up against the frame edge, where the band above
# it is thin but runs the full width of the crop and holds thousands of pixels.
# A sliver of a few pixels says nothing; a thin wide band says plenty.
MIN_PROBE_SHARE = 0.08


def _pattern_extends(frame: np.ndarray, cx: float, cy: float, side: float,
                    stats: dict) -> int:
    """How many directions the sticker pattern carries on beyond the crop.

    A cube face ends: one cell beyond the crop is the room, or another face, not
    another sticker of exactly the same colour. A tiled floor, a radiator grille
    or a window does not end - the same grid of flat cells with the same kind of
    dark line between them keeps going, which is why those panes read as nine
    stickers. The comparison is on the actual colour, not the facelet letter:
    a white sticker and a pale grey desk are both "white", but only one of them
    is the sticker next door.

    Directions with nothing but frame edge beyond them are ignored, so a cube
    that fills the picture is not held against this.
    """
    height, width = frame.shape[:2]
    means = stats["means"]
    half = side / 2.0
    depth = max(3.0, side / 3.0)
    probes = (
        ((2, 5, 8), True, (cx + half, cy - half, min(width, cx + half + depth), cy + half)),
        ((0, 3, 6), True, (max(0.0, cx - half - depth), cy - half, cx - half, cy + half)),
        ((6, 7, 8), False, (cx - half, cy + half, cx + half, min(height, cy + half + depth))),
        ((0, 1, 2), False, (cx - half, max(0.0, cy - half - depth), cx + half, cy - half)),
    )

    continuing = 0
    for cells, vertical, box in probes:
        x0, y0, x1, y1 = (int(round(value)) for value in box)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        if (x1 - x0) * (y1 - y0) < MIN_PROBE_SHARE * depth * side:
            continue  # a sliver of frame edge is not evidence either way
        hits = 0
        for index, cell_index in enumerate(cells):
            if vertical:
                top = y0 + (y1 - y0) * index // 3
                bottom = y0 + (y1 - y0) * (index + 1) // 3
                cell = frame[top:bottom, x0:x1]
            else:
                left = x0 + (x1 - x0) * index // 3
                right = x0 + (x1 - x0) * (index + 1) // 3
                cell = frame[y0:y1, left:right]
            if cell.size == 0:
                continue
            mean = cell.reshape(-1, 3).mean(axis=0)
            if float(np.abs(mean - means[cell_index]).max()) <= LINE_COLOUR_GAP:
                hits += 1
        if hits >= 2:
            continuing += 1
    return continuing


def _score(stats: dict, coverage: float, angle: float) -> tuple:
    """Ranking for one candidate crop.

    Readable stickers first, then how much of a cube face the crop actually
    looks like: its visible sticker boundaries, its flat cells, whether it has
    any plastic visible at all, and only then how much of the frame it covers.

    The plastic signal is a band rather than a maximum. "More dark pixels" is not
    "more of a face": a crop centred on a gap junction between four stickers is
    nearly half plastic and reads a blend of the four colours, and rewarding that
    let such a crop outrank the face itself. A crop with no plastic at all has
    left the face and is reading a desk. A face looks like its own plastic share,
    so the closer the crop is to that, the better.
    """
    plastic = -round(abs(stats["gaps"] - GAP_SHARE_TYPICAL), 3)
    return (stats["matched"], stats["lines"], stats["flat"], plastic,
            round(coverage, 3), -abs(angle))


def _rejected(reason: str, coverage: float = 0.0) -> dict:
    """A frame the scanner refuses to read, with the reason why."""
    return {
        "found": False,
        "framed": False,
        "source": "",
        "angle": 0.0,
        "scale": 0.0,
        "offset": (0.0, 0.0),
        "coverage": round(coverage, 3),
        "colours": [None] * 9,
        "confidence": 0.0,
        "reason": reason,
    }


def analyse_face(image: Image) -> dict:
    """Read one camera frame and say whether a cube face was actually found.

    A frame is not a cropped sticker sheet: it is a room with a cube in it, and
    a cube is rarely held dead square, dead centre and filling the frame. The
    sampler used to take the bounding box of the largest four-sided contour
    and, finding none, fall back to the whole picture, so the nine "stickers"
    were patches of the room and the scan then blamed the cube: "frame 2 should
    be the red (R) face but its centre reads as green".

    This searches the frame for a crop that looks like a face: a detected
    face-sized quadrilateral straightened by perspective, and windows of the
    frame at several positions, sizes and small rotations. A crop is only
    accepted when all nine of its cells read as cube colours *and* it shows the
    3x3 structure of a face, so a patch of wall, a wooden desk or a window with
    mullions is refused instead of being turned into nine confident stickers.

    Returns a dict with ``colours`` (nine letters or ``None``), ``confidence``,
    ``found`` (nine readable stickers), ``framed`` (the nine came from a
    detected face-sized quad rather than a square window), ``source``,
    ``coverage``, ``scale``, ``offset``, ``angle`` and a human-readable
    ``reason`` when refused.
    """
    img = _to_bgr(image)
    if img is None or img.size == 0:
        return _rejected("the frame could not be decoded")

    work = _working_frame(img)
    height, width = work.shape[:2]
    short = float(min(height, width))
    frame_area = short * short

    rotations: dict = {0.0: work}

    def rotated(angle: float) -> np.ndarray:
        key = round(angle, 1)
        if key not in rotations:
            rotations[key] = _rotated(work, key)
        return rotations[key]

    candidates: List[Tuple[str, float, float, float, Tuple[float, float], np.ndarray]] = []
    quadrangles = _quad_list(work)
    seeds: List[Tuple[tuple, float, float, float, float]] = []
    centroids: List[np.ndarray] = []
    sticker_sides: List[float] = []

    # 1. Every detected quadrilateral is a candidate crop in its own right,
    #    straightened by perspective, and a hint about how the cube is rotated.
    for quad in quadrangles:
        angle = round(_quad_angle(quad), 1)
        side = float(np.sqrt(max(1.0, cv2.contourArea(quad))))
        coverage = min(1.0, (side * side) / frame_area)
        for inset in QUAD_INSETS:
            shape = _inset_quad(quad, inset)
            candidates.append(("quad", angle, coverage, coverage,
                               (0.0, 0.0), warp_face(work, shape)))

        # 2. A coarse sweep to find where the face is, anchored on the detected
        #    shape: a sticker puts the face centre within one sticker of it and
        #    the face side at about three times its own, and all of that holds
        #    wherever in the frame the cube happens to be held. Scenery cannot
        #    move the face this way, and a face whose outline the edge detector
        #    missed is still covered by the middle-of-the-frame grid below.
        centre = np.asarray(quad, dtype=np.float32).reshape(4, 2).mean(axis=0)
        centroids.append(centre)
        sticker_sides.append(side)
        frame_rot = rotated(angle)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for factor in (2.0, 3.0, 4.2):
                    size = factor * side
                    if not 0.12 * short <= size <= 1.15 * short:
                        continue
                    dx = (centre[0] + i * side - width / 2.0) / short
                    dy = (centre[1] + j * side - height / 2.0) / short
                    ox, oy = _rotated_offset(dx * short, dy * short, angle)
                    crop = _square_at(frame_rot, width / 2.0 + ox, height / 2.0 + oy, size)
                    if crop is None:
                        continue
                    stats = _crop_stats(crop)
                    seeds.append((_score(stats, size / short, angle), dx, dy, size / short, angle))

    # The stickers the edge detector found all sit on the face, so the middle of
    # them is the middle of the face - a better guess than any grid point, and
    # the one that matters when the cube is held towards one side of the frame.
    if len(quadrangles) >= 2:
        middle = np.mean(np.stack(centroids), axis=0)
        mean_side = float(np.mean(sticker_sides))
        for factor in (2.6, 3.0, 3.6):
            size = factor * mean_side
            if not 0.12 * short <= size <= 1.15 * short:
                continue
            crop = _square_at(work, middle[0], middle[1], size)
            if crop is None:
                continue
            stats = _crop_stats(crop)
            seeds.append((_score(stats, size / short, 0.0),
                          (middle[0] - width / 2.0) / short,
                          (middle[1] - height / 2.0) / short,
                          size / short, 0.0))

    # 3. A grid in the middle of the frame, for a face with no detectable edge.
    centre_seed: Optional[Tuple[tuple, float, float, float, float]] = None
    for scale in GRID_SCALES:
        for dx in GRID_POSITION_OFFSETS:
            for dy in GRID_POSITION_OFFSETS:
                crop = _square_at(work, width / 2.0 + dx * short, height / 2.0 + dy * short,
                                  scale * short)
                if crop is None:
                    continue
                stats = _crop_stats(crop)
                entry = (_score(stats, scale, 0.0), dx, dy, scale, 0.0)
                seeds.append(entry)
                if dx == 0.0 and dy == 0.0 and (centre_seed is None or entry[0] > centre_seed[0]):
                    # The scanner asks the user to fill the frame with one face,
                    # so dead centre at the best size deserves a place in the
                    # refinement whatever the rest of the frame scores.
                    centre_seed = entry
    seeds.sort(key=lambda item: item[0], reverse=True)

    # 4. The best few positions, refined: a fraction of a cell either way, a few
    #    degrees either side of the shape's own rotation, and a little larger or
    #    smaller. Every seed is also tried at the rotations the detected shapes
    #    suggest, because a cube tilted in front of the camera has its stickers
    #    telling us how far round it is even when the face itself is centred.
    seed_picks: List[Tuple[float, float, float, float]] = []
    for _, dx, dy, scale, base in seeds:
        if any(abs(dx - ox) < 0.10 and abs(dy - oy) < 0.10 and abs(scale - os) < 0.15
               and abs(base - ob) < 10.0 for ox, oy, os, ob in seed_picks):
            continue
        seed_picks.append((dx, dy, scale, base))
        if len(seed_picks) >= FINE_SEEDS:
            break
    if centre_seed is not None and not any(abs(dx) < 0.05 and abs(dy) < 0.05
                                           for dx, dy, _, _ in seed_picks):
        seed_picks.append((centre_seed[1], centre_seed[2], centre_seed[3], centre_seed[4]))

    shape_angles: List[float] = []
    for quad in quadrangles:
        for step in (-7.0, 0.0, 7.0):
            angle = round(_quad_angle(quad) + step, 1)
            if angle not in shape_angles:
                shape_angles.append(angle)

    def add_candidate(dx: float, dy: float, scale: float, angle: float) -> None:
        frame_rot = rotated(angle)
        ox, oy = _rotated_offset(dx * short, dy * short, angle)
        for step in FINE_SCALE_STEPS:
            size = scale * short * step
            crop = _square_at(frame_rot, width / 2.0 + ox, height / 2.0 + oy, size)
            if crop is None:
                continue
            candidates.append(("centre", round(angle, 1), round(scale * step, 3),
                               crop.shape[0] / short, (dx, dy), crop))

    for index, (dx, dy, scale, base) in enumerate(seed_picks):
        if index < FINE_NUDGE_SEEDS:
            nudge = scale / 3.0 * 0.5  # half a cell, as a share of the shorter side
            for sub_x in FINE_NUDGES:
                for sub_y in FINE_NUDGES:
                    for step_angle in FINE_NUDGE_ANGLES:
                        add_candidate(dx + sub_x * nudge, dy + sub_y * nudge, scale,
                                      round(base + step_angle, 1))
        for step_angle in FINE_ANGLES:
            add_candidate(dx, dy, scale, round(base + step_angle, 1))
        for shape_angle in shape_angles:
            if abs(shape_angle - base) > 1.0:
                add_candidate(dx, dy, scale, shape_angle)



    if not candidates:  # pragma: no cover - the frame always yields something
        return _rejected("no crop could be sampled")

    rows = []
    for source, angle, scale, coverage, offset, crop in candidates:
        stats = _crop_stats(crop)
        rows.append((_score(stats, coverage, angle), (source, angle, scale, coverage, offset, crop), stats))
    rows.sort(key=lambda row: row[0], reverse=True)

    # A detected face-sized quadrilateral is direct evidence of where the face
    # is, so a window that passes the gates only gets the frame if no quad does.
    # Reading nine plausible colours out of a square window is circumstantial:
    # on a bright desk a window half a sticker out reads the desk as stickers.
    chosen: Optional[Tuple[tuple, tuple, dict]] = None
    best_any = rows[0]
    checked = 0
    for want_quad in (True, False):
        for score, candidate, stats in rows:
            if want_quad and candidate[0] != "quad":
                continue
            if stats["matched"] < 9 or stats["lines"] < MIN_INTERNAL_LINES:
                continue
            checked += 1
            if checked > ACCEPT_SCAN_MAX:
                break
            if not _read_is_stable(candidate[5], list(stats["colours"])):
                continue
            if candidate[0] == "centre":
                ox, oy = _rotated_offset(candidate[4][0] * short, candidate[4][1] * short,
                                         candidate[1])
                if _pattern_extends(rotated(candidate[1]), width / 2.0 + ox, height / 2.0 + oy,
                                    candidate[2] * short, stats) >= 1:
                    continue
            chosen = (score, candidate, stats)
            break
        if chosen is not None:
            break

    best_score, best, best_stats = chosen if chosen is not None else best_any
    matched = best_stats["matched"]

    if chosen is None:
        if matched < 9:
            return _rejected(
                f"only {matched} of the 9 stickers could be read "
                f"({9 - matched} unreadable). Hold one face square to the camera, "
                "filling most of the frame, with even light",
                best[3],
            )
        return _rejected(
            "the frame does not show a cube face: nine cells read as colours but "
            f"only {best_stats['lines']} of the 4 lines between the stickers are "
            "there, or the colours change when the grid moves a little, which is "
            "what a wall, a desk or a single sticker looks like. Hold one face "
            "square to the camera, filling most of the frame, with the plastic "
            "between the stickers visible",
            best[3],
        )

    return {
        "found": True,
        "framed": best[0] == "quad",
        "source": best[0],
        "angle": round(best[1], 1),
        "scale": round(best[2], 3),
        "offset": (round(best[4][0], 3), round(best[4][1], 3)),
        "coverage": round(best[3], 3),
        "colours": list(best_stats["colours"]),
        "confidence": round(matched / 9.0, 3),
        "reason": "",
    }


# ------------------------------------------------------- legacy face sampler ---


def _find_face_box(img: np.ndarray) -> Tuple[int, int, int, int]:
    """Bounding box of the largest four-sided contour, else the whole frame."""
    quad = _quad_candidates(img)
    if quad is None:
        height, width = img.shape[:2]
        return 0, 0, width, height
    return cv2.boundingRect(quad)


def _sample_grid_colours(img: np.ndarray) -> Tuple[List[Optional[str]], float]:
    """Sample nine stickers from an image already cropped to one face."""
    if img is None or img.size == 0:
        return [None] * 9, 0.0

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    height, width = img.shape[:2]
    cell_w = max(1, width // 3)
    cell_h = max(1, height // 3)

    colors: List[Optional[str]] = []
    for row in range(3):
        for col in range(3):
            cx = col * cell_w + cell_w // 2
            cy = row * cell_h + cell_h // 2
            region = hsv[max(0, cy - 5):cy + 5, max(0, cx - 5):cx + 5]
            if region.size == 0:
                colors.append(None)
                continue
            colors.append(classify_hsv(np.mean(region, axis=(0, 1))))

    matched = sum(1 for color in colors if color is not None)
    return colors, matched / 9.0


def detect_face_colors(image: Image) -> Tuple[List[Optional[str]], float]:
    """Return ``(colours, confidence)`` for an already-cropped face image.

    This is the sticker classifier, not the frame reader: it assumes the image
    handed to it is one face and says nothing about whether it is. Frames from
    the camera go through :func:`analyse_face`, which refuses the ones that do
    not contain a face.
    """
    img = _to_bgr(image)
    if img is None or img.size == 0:
        return [None] * 9, 0.0

    x, y, w, h = _find_face_box(img)
    return _sample_grid_colours(img[y:y + h, x:x + w])


def detect_colors(image: Image) -> Optional[List[str]]:
    """Return the nine facelet letters of one face, or ``None`` if any sticker
    could not be classified."""
    colors, _ = detect_face_colors(image)
    if colors is None or any(color is None for color in colors):
        return None
    return colors  # type: ignore[return-value]


def detect_cube_state(images: List[Image]) -> Optional[str]:
    """Return the 54-character facelet string for six face images."""
    facelets: List[str] = []
    for image in images:
        colors = detect_colors(image)
        if colors is None:
            return None
        facelets.extend(colors)
    if len(facelets) != 54:
        return None
    return "".join(facelets)


def get_color_statistics(image: Image) -> dict:
    """Average HSV of each facelet (debug helper)."""
    img = _to_bgr(image)
    if img is None:
        return {}
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    height, width = img.shape[:2]
    cell_w = max(1, width // 3)
    cell_h = max(1, height // 3)
    stats = {}
    for row in range(3):
        for col in range(3):
            cx = col * cell_w + cell_w // 2
            cy = row * cell_h + cell_h // 2
            region = hsv[max(0, cy - 5):cy + 5, max(0, cx - 5):cx + 5]
            if region.size == 0:
                continue
            avg = np.mean(region, axis=(0, 1))
            stats[f"{row},{col}"] = {"h": float(avg[0]), "s": float(avg[1]), "v": float(avg[2])}
    return stats


def detect_face_stability(image: Image) -> dict:
    """Analyse a frame and report whether a cube face is clearly visible.

    Returns a dict with:
        - ``face_detected``: bool — the scanner found a readable cube face
        - ``coverage``: float — share of the frame the face occupies (0-1)
        - ``confidence``: float — how classifiable the detected stickers are
        - ``colours``: list — the nine facelet letters (or ``None``)
        - ``grid_score``: float — how grid-like the interior edges are (0-1)

    This powers the live face-detection overlay and auto-capture, so it answers
    with the same sampler the scan uses: an overlay that lights up green for a
    frame the scanner will then refuse is worse than no overlay. It runs that
    sampler on a frame half the size, though, because this endpoint is polled
    twice a second and the full search takes half a second: the overlay only has
    to say whether a face is there, and the scan itself reads the full frame.
    """
    img = _to_bgr(image)
    if img is None or img.size == 0:
        return {
            "face_detected": False,
            "coverage": 0.0,
            "confidence": 0.0,
            "colours": [None] * 9,
            "grid_score": 0.0,
        }

    height, width = img.shape[:2]
    if min(height, width) > PREVIEW_MIN_SIDE:
        factor = PREVIEW_MIN_SIDE / float(min(height, width))
        img = cv2.resize(img, (max(8, int(round(width * factor))),
                              max(8, int(round(height * factor)))),
                         interpolation=cv2.INTER_AREA)

    result = analyse_face(img)
    work = _working_frame(img)
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    quad = _quad_candidates(work)
    if quad is None:
        grid_score = 0.0
    else:
        x, y, w, h = cv2.boundingRect(quad)
        roi = edges[y:y + h, x:x + w]
        if roi.size == 0:
            grid_score = 0.0
        else:
            lines = cv2.HoughLinesP(roi, 1, np.pi / 180, threshold=30,
                                    minLineLength=max(1, min(w, h) // 4), maxLineGap=10)
            vertical = horizontal = 0
            for line in ([] if lines is None else lines):
                x1, y1, x2, y2 = line[0]
                dx, dy = abs(x2 - x1), abs(y2 - y1)
                if dx == 0 and dy == 0:
                    continue
                angle = abs(np.arctan2(dy, dx) * 180 / np.pi)
                if angle <= 15:
                    horizontal += 1
                elif angle >= 75:
                    vertical += 1
            found = min(vertical, 2) + min(horizontal, 2)
            grid_score = min(1.0, found / 4)

    return {
        "face_detected": bool(result["found"]),
        "coverage": round(float(result["coverage"]), 3),
        "confidence": round(float(result["confidence"]), 3),
        "colours": result["colours"],
        "grid_score": round(grid_score, 3),
    }
