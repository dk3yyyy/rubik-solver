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
