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


def _find_face_box(img: np.ndarray) -> Tuple[int, int, int, int]:
    """Locate the cube face and return its bounding box.

    Picks the largest four-sided contour rather than the first one found, which
    could be a small background object. Falls back to the whole frame.
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

    if best is None:
        height, width = img.shape[:2]
        return 0, 0, width, height
    return cv2.boundingRect(best)


def detect_face_colors(image: Image) -> Tuple[List[Optional[str]], float]:
    """Return ``(colours, confidence)`` for a single face image.

    ``colours`` is nine facelet letters (or ``None`` entries for stickers that
    could not be classified); ``confidence`` is the fraction of stickers that
    were classified, so a caller can require e.g. 0.9 before trusting a scan.
    """
    img = _to_bgr(image)
    if img is None or img.size == 0:
        return [None] * 9, 0.0

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    x, y, w, h = _find_face_box(img)
    cell_w = max(1, w // 3)
    cell_h = max(1, h // 3)

    colors: List[Optional[str]] = []
    for row in range(3):
        for col in range(3):
            cx = x + col * cell_w + cell_w // 2
            cy = y + row * cell_h + cell_h // 2
            region = hsv[max(0, cy - 5):cy + 5, max(0, cx - 5):cx + 5]
            if region.size == 0:
                colors.append(None)
                continue
            colors.append(classify_hsv(np.mean(region, axis=(0, 1))))

    matched = sum(1 for color in colors if color is not None)
    return colors, matched / 9.0


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
