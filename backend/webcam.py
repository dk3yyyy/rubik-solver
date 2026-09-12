"""Colour classification for webcam cube scanning.

Each cube face is sampled as a 3x3 grid of stickers, the average HSV of every
sticker is classified against the six cube colours, and the result is returned
as facelet letters.

The previous implementation defaulted every unrecognised sticker to white
(``'U'``), so a miscalibrated or badly lit scan silently produced a plausible
but wrong cube state. Unmatched stickers are now reported as ``None`` with a
reduced confidence score so the caller can reject the scan instead of guessing.
"""

from typing import List, Optional, Tuple, Union

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

# A scan frame is a room with a cube in it, not a cropped sticker sheet. These
# describe what has to be true before the nine samples are allowed to be called
# stickers.
#
# The sampler used to take the bounding box of the largest four-sided contour
# and, finding none, fall back to the whole picture. On a real frame that put
# the nine "stickers" on the wall, the desk and the shirt, and the scan then
# blamed the cube: "frame 2 should be the red (R) face but its centre reads as
# green". A quad that covers less of the frame than this is some object behind
# the cube, not the cube.
MIN_FACE_COVERAGE = 0.05
# Side of the square a detected quad is straightened to before sampling.
FACE_SAMPLE_SIZE = 300
# A cube is rarely held dead square to the camera, and the face is not always
# exactly centred, so the sampling grid is not assumed to be either: a few sizes
# and small rotations of the middle of the frame are tried and the candidate
# whose nine cells read as flat stickers wins.
GRID_SEARCH_SCALES = (0.35, 0.45, 0.6, 0.75, 0.9)
GRID_SEARCH_ANGLES = (-28.0, -21.0, -14.0, -7.0, 0.0, 7.0, 14.0, 21.0, 28.0)
# Spread of colour inside one sampled cell that still counts as one sticker, and
# how much of the cell to test. A patch that is small next to a big cell would
# sit inside *some* sticker however far out the grid is.
FLAT_SPREAD_MAX = 40
FLAT_PATCH_SHARE = 0.28
# Sticker gaps are near-black plastic. Their presence is how a cube face is told
# apart from a flat patch of background of the same colour, which matters when a
# bright window and the cube both fill a plausible crop.
GAP_MAX_VALUE = 60


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


def _quad_candidates(img: np.ndarray) -> Optional[np.ndarray]:
    """The corner points of the largest four-sided contour, or ``None``.

    Corners rather than a bounding box: a face photographed at an angle is a
    quadrilateral, and its bounding box clips the corners off the 3x3 grid that
    is walked afterwards. A cube seen corner-on outlines as a hexagon and is
    deliberately not returned here.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None
    best_area = 0.0
    for contour in contours:
        area = cv2.contourArea(contour)
        if area <= 1000 or area <= best_area:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.1 * peri, True)
        if len(approx) == 4:
            best = approx
            best_area = area

    return best


def _find_face_box(img: np.ndarray) -> Tuple[int, int, int, int]:
    """Bounding box of the largest four-sided contour, else the whole frame."""
    quad = _quad_candidates(img)
    if quad is None:
        height, width = img.shape[:2]
        return 0, 0, width, height
    return cv2.boundingRect(quad)


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


def _centre_square(img: np.ndarray, scale: float) -> np.ndarray:
    """The middle of the frame, sized to ``scale`` of its shorter side.

    The scanner asks the user to fill the frame with one face, so the middle is
    where the cube is and a square there is a far better guess than the whole
    picture.
    """
    height, width = img.shape[:2]
    side = max(3, int(min(height, width) * scale))
    top = (height - side) // 2
    left = (width - side) // 2
    return img[top:top + side, left:left + side]


def _rotated(img: np.ndarray, angle: float) -> np.ndarray:
    """Rotate about the centre, keeping the frame size."""
    if not angle:
        return img
    height, width = img.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), angle, 1.0)
    return cv2.warpAffine(
        img, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


def _flat_cells(img: np.ndarray) -> int:
    """How many of the nine cells look like one flat sticker.

    A cell that straddles a sticker edge, a gap or the background varies across
    itself; one sitting on a sticker does not. The sampled patch is scaled to
    the cell size, because a patch that is small next to a big cell stays inside
    *some* sticker however far out the grid is, and then every alignment looks
    equally good. This is what the rotation and scale search maximises, so it
    has to actually notice a grid that is a few degrees or a few percent out.
    """
    if img is None or img.size == 0:
        return 0
    height, width = img.shape[:2]
    cell_h, cell_w = height // 3, width // 3
    if cell_h < 3 or cell_w < 3:
        return 0

    # Middle of the cell, as a share of the cell, so it scales with the crop.
    half_h = max(6, int(cell_h * FLAT_PATCH_SHARE))
    half_w = max(6, int(cell_w * FLAT_PATCH_SHARE))

    flat = 0
    for row in range(3):
        for col in range(3):
            cy = row * cell_h + cell_h // 2
            cx = col * cell_w + cell_w // 2
            patch = img[max(0, cy - half_h):cy + half_h, max(0, cx - half_w):cx + half_w]
            if patch.size == 0:
                continue
            mean = patch.reshape(-1, 3).mean(axis=0)
            quarters = (
                patch[: patch.shape[0] // 2, : patch.shape[1] // 2],
                patch[: patch.shape[0] // 2, patch.shape[1] // 2:],
                patch[patch.shape[0] // 2:, : patch.shape[1] // 2],
                patch[patch.shape[0] // 2:, patch.shape[1] // 2:],
            )
            worst = 0.0
            for quarter in quarters:
                if quarter.size == 0:
                    continue
                quarter_mean = quarter.reshape(-1, 3).mean(axis=0)
                worst = max(worst, float(np.abs(quarter_mean - mean).max()))
            if worst < FLAT_SPREAD_MAX:
                flat += 1
    return flat


def _score_crop(crop: np.ndarray) -> Tuple[int, int, float]:
    """``(stickers read, flat cells, sticker gaps)`` for one candidate crop."""
    colours, _ = _sample_grid_colours(crop)
    matched = sum(1 for color in colours if color is not None)
    return matched, _flat_cells(crop), _gap_fraction(crop)


def _rejected(reason: str, coverage: float = 0.0) -> dict:
    """A frame the scanner refuses to read, with the reason why."""
    return {
        "found": False,
        "framed": False,
        "source": "",
        "angle": 0.0,
        "scale": 0.0,
        "coverage": round(coverage, 3),
        "colours": [None] * 9,
        "confidence": 0.0,
        "reason": reason,
    }


def analyse_face(image: Image) -> dict:
    """Read one camera frame and say whether a cube face was actually found.

    A frame is not a cropped sticker sheet: it is a room with a cube in it, and
    a cube is rarely held dead square to the camera. The sampler used to take
    the bounding box of the largest four-sided contour and, finding none, fall
    back to the whole picture. On a real cube the largest four-sided contour is
    a *sticker*, not the face, because a face has rounded corners; so the nine
    samples landed on the wall, the desk and the shirt, and the scan then blamed
    the cube: "frame 2 should be the red (R) face but its centre reads as
    green".

    Instead this looks at candidates: a detected face-sized quad straightened by
    perspective, and the middle of the frame at a few sizes and small rotations
    (nobody holds a cube square). The candidate with the most readable, flattest
    stickers wins, and a frame that produces no such candidate is reported as a
    frame that could not be read rather than turned into nine confident
    stickers.

    Returns a dict with ``colours`` (nine letters or ``None``), ``confidence``,
    ``found`` (nine readable stickers), ``framed`` (the nine came from a
    detected face-sized quad rather than the middle of the frame), ``source``,
    ``coverage``, ``angle`` and a human-readable ``reason`` when refused.
    """
    img = _to_bgr(image)
    if img is None or img.size == 0:
        return _rejected("the frame could not be decoded")

    height, width = img.shape[:2]
    frame_area = float(max(1, height * width))

    candidates: List[Tuple[str, float, float, np.ndarray]] = []
    quad = _quad_candidates(img)
    coverage = float(cv2.contourArea(quad)) / frame_area if quad is not None else 0.0
    if quad is not None and coverage >= MIN_FACE_COVERAGE:
        candidates.append(("quad", 0.0, 1.0, warp_face(img, quad)))
    for scale in GRID_SEARCH_SCALES:
        square = _centre_square(img, scale)
        for angle in GRID_SEARCH_ANGLES:
            candidates.append(("centre", float(angle), scale, _rotated(square, angle)))

    best: Optional[dict] = None
    for source, angle, scale, crop in candidates:
        matched, flat, gaps = _score_crop(crop)
        # Compared in this order: the most readable stickers, then the straightest
        # grid, then the most sticker gap (a real face has plastic between its
        # stickers and a patch of background does not), and only then the crop
        # that shows most of the face. Without that last part a small crop that
        # happens to sit inside one flat area beats the face itself, which is how
        # a sticker with the wrong colour gets quietly dropped.
        candidate = {
            "score": (matched, flat, round(gaps, 2), scale, -abs(angle)),
            "source": source,
            "angle": angle,
            "scale": scale,
            "crop": crop,
        }
        if best is None or candidate["score"] > best["score"]:
            best = candidate

    if best is None:  # pragma: no cover - the centre squares always contribute
        return _rejected("no crop could be sampled", coverage)

    matched = best["score"][0]
    if matched < 9:
        return _rejected(
            f"only {matched} of the 9 stickers could be read "
            f"({9 - matched} unreadable). Hold one face square to the camera, "
            "filling most of the frame, with even light",
            coverage,
        )

    colours, confidence = _sample_grid_colours(best["crop"])
    return {
        "found": True,
        "framed": best["source"] == "quad",
        "source": best["source"],
        "angle": best["angle"],
        "scale": best["scale"],
        "coverage": round(coverage, 3),
        "colours": colours,
        "confidence": round(confidence, 3),
        "reason": "",
    }


def _gap_fraction(img: np.ndarray) -> float:
    """Share of the crop that is near-black sticker gap.

    A cube face has plastic between its stickers. A patch of wall, desk or sky
    that happens to be the right colour does not, which is what makes this the
    tie-breaker when two crops both read as nine stickers.
    """
    if img is None or img.size == 0:
        return 0.0
    value = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 2]
    return float(np.count_nonzero(value < GAP_MAX_VALUE)) / max(1, value.size)


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
    """Return ``(colours, confidence)`` for a single face image.

    ``colours`` is nine facelet letters (or ``None`` entries for stickers that
    could not be classified); ``confidence`` is the fraction of stickers that
    were classified, so a caller can require e.g. 0.9 before trusting a scan.
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
        - ``face_detected``: bool — a quadrilateral of sufficient area was found
        - ``coverage``: float — fraction of the frame the face occupies (0-1)
        - ``confidence``: float — how classifiable the detected stickers are
        - ``colours``: list — the nine facelet letters (or ``None``)
        - ``grid_score``: float — how grid-like the interior edges are (0-1)

    This powers the live face-detection overlay and auto-capture: the frontend
    polls this endpoint and shows a green border when ``face_detected`` is true
    and the confidence is high enough to trust a capture.
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
    frame_area = max(1, height * width)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)

    quad = _quad_candidates(img)

    if quad is None:
        return {
            "face_detected": False,
            "coverage": 0.0,
            "confidence": 0.0,
            "colours": [None] * 9,
            "grid_score": 0.0,
        }

    x, y, w, h = cv2.boundingRect(quad)
    coverage = cv2.contourArea(quad) / frame_area

    # Grid score: look for interior vertical/horizontal lines inside the face
    # box. A real cube face has edges between the 3x3 stickers.
    roi = edges[y:y + h, x:x + w]
    if roi.size == 0:
        grid_score = 0.0
    else:
        lines = cv2.HoughLinesP(roi, 1, np.pi / 180, threshold=30,
                                minLineLength=min(w, h) // 4, maxLineGap=10)
        if lines is None:
            grid_score = 0.0
        else:
            # Count near-vertical and near-horizontal lines.
            vertical = 0
            horizontal = 0
            for line in lines:
                x1, y1, x2, y2 = line[0]
                dx = abs(x2 - x1)
                dy = abs(y2 - y1)
                if dx == 0 and dy == 0:
                    continue
                angle = abs(np.arctan2(dy, dx) * 180 / np.pi)
                if angle <= 15:
                    horizontal += 1
                elif angle >= 75:
                    vertical += 1
            # A 3x3 grid has 2 interior vertical + 2 interior horizontal lines.
            expected = 4
            found = min(vertical, 2) + min(horizontal, 2)
            grid_score = min(1.0, found / expected)

    # Sample the straightened face rather than its bounding box, so a cube held
    # at an angle still reads the right nine cells.
    colours, confidence = _sample_grid_colours(warp_face(img, quad))

    # Face is "detected" when the quad is a decent share of the frame.
    face_detected = coverage > MIN_FACE_COVERAGE

    return {
        "face_detected": face_detected,
        "coverage": round(coverage, 3),
        "confidence": round(confidence, 3),
        "colours": colours,
        "grid_score": round(grid_score, 3),
    }
