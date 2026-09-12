"""Synthetic cube-face images for the webcam tests.

Each face is a 3x3 grid of solid colour cells; the BGR values are chosen so
that OpenCV maps them into the hue bands the detector expects.
"""

import base64
from typing import List, Sequence

import cv2
import numpy as np

CUBE_BGR = {
    "U": (255, 255, 255),  # white
    "R": (0, 0, 255),      # red
    "F": (0, 255, 0),      # green
    "D": (0, 255, 255),    # yellow
    "L": (0, 128, 255),    # orange
    "B": (255, 0, 0),      # blue
}

AMBIGUOUS_BGR = (128, 128, 128)  # mid grey: neither white nor saturated


def make_face_image(letters: Sequence[str], cell: int = 60) -> np.ndarray:
    """Render a 3x3 face from nine facelet letters."""
    img = np.zeros((cell * 3, cell * 3, 3), dtype=np.uint8)
    for index, letter in enumerate(letters):
        row, col = divmod(index, 3)
        img[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = CUBE_BGR[letter]
    return img


def jpeg_bytes(img: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".jpg", img)
    assert ok
    return buffer.tobytes()


def base64_face(letters: Sequence[str]) -> str:
    return base64.b64encode(jpeg_bytes(make_face_image(letters))).decode()


def solved_faces() -> List[str]:
    """One base64 image per face, in U, R, F, D, L, B order."""
    return [base64_face(letter * 9) for letter in "URFDLB"]


def base64_ambiguous_face(cell: int = 60) -> str:
    """One face of mid grey stickers, which the detector cannot classify."""
    img = np.zeros((cell * 3, cell * 3, 3), dtype=np.uint8)
    img[:, :] = AMBIGUOUS_BGR
    return base64.b64encode(jpeg_bytes(img)).decode()


def make_face_patch(letters: Sequence[str], size: int = 180, gap: int = 5) -> np.ndarray:
    """One cube face as it looks on a real cube: stickers, black plastic between.

    ``make_face_image`` renders nine flush cells with no gaps, which is fine for
    testing colour classification but nothing like a photographed cube. The gaps
    matter to the scanner: they are how a face is told apart from a patch of
    background that happens to be the same colour.
    """
    img = np.zeros((size, size, 3), dtype=np.uint8)
    cell = size // 3
    for index, letter in enumerate(letters):
        row, col = divmod(index, 3)
        top = row * cell + gap
        left = col * cell + gap
        img[top:top + cell - gap, left:left + cell - gap] = CUBE_BGR[letter]
    return img


def make_frame(
    letters: Sequence[str],
    *,
    frame_size=(480, 640),
    coverage: float = 0.7,
    angle: float = 0.0,
    background=(70, 70, 70),
    quads=(),
) -> np.ndarray:
    """A camera frame: a desk, optional background quads, and one cube face.

    ``coverage`` is the share of the shorter frame side the face spans, so 0.7
    is a cube held close and filling most of the picture, and 0.2 is one held at
    arm's length. ``quads`` are (corners, BGR) pairs drawn behind the cube, for
    testing that scenery does not get read as the face.
    """
    height, width = frame_size
    img = np.full((height, width, 3), background, dtype=np.uint8)

    for corners, colour in quads:
        cv2.fillConvexPoly(img, np.array(corners, dtype=np.int32), colour)

    side = int(min(height, width) * coverage)
    patch = make_face_patch(letters, size=180)
    centre_x, centre_y = width / 2, height / 2
    half = side / 2
    corners = np.array(
        [[-half, -half], [half, -half], [half, half], [-half, half]], dtype=np.float32
    )
    if angle:
        radians = np.deg2rad(angle)
        rotation = np.array(
            [[np.cos(radians), -np.sin(radians)], [np.sin(radians), np.cos(radians)]],
            dtype=np.float32,
        )
        corners = corners @ rotation.T
    destination = corners + np.array([centre_x, centre_y], dtype=np.float32)

    source = np.array(
        [[0, 0], [179, 0], [179, 179], [0, 179]], dtype=np.float32
    )
    matrix = cv2.getPerspectiveTransform(source, destination)
    warped = cv2.warpPerspective(patch, matrix, (width, height))
    mask = cv2.warpPerspective(
        np.full((180, 180), 255, dtype=np.uint8), matrix, (width, height)
    )
    img[mask > 0] = warped[mask > 0]
    return img


def base64_frame(letters: Sequence[str], **kwargs) -> str:
    """A full camera frame, as the scanner receives it, base64 JPEG."""
    return base64.b64encode(jpeg_bytes(make_frame(letters, **kwargs))).decode()
