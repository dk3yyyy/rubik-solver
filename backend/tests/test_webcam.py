"""Colour classification and face sampling."""

import cv2
import numpy as np

from helpers import AMBIGUOUS_BGR, CUBE_BGR, make_face_image
from webcam import (
    classify_hsv,
    detect_colors,
    detect_face_colors,
    detect_cube_state,
    get_color_statistics,
)


def _hsv_of(bgr):
    pixel = np.uint8([[bgr]])
    return cv2.cvtColor(pixel, cv2.COLOR_BGR2HSV)[0, 0]


def test_every_cube_colour_is_classified():
    for letter, bgr in CUBE_BGR.items():
        assert classify_hsv(_hsv_of(bgr)) == letter, letter


def test_grey_is_not_guessed_as_white():
    # Regression: unrecognised stickers used to default to white ('U').
    assert classify_hsv(_hsv_of(AMBIGUOUS_BGR)) is None


def test_dark_pixels_are_rejected():
    assert classify_hsv(_hsv_of((10, 10, 10))) is None


def test_face_detection_reads_every_sticker():
    letters = list("URFDLBURF")
    colors, confidence = detect_face_colors(make_face_image(letters))
    assert colors == letters
    assert confidence == 1.0


def test_unmatched_sticker_lowers_confidence():
    img = make_face_image(list("URFDLBURF"))
    img[0:60, 0:60] = AMBIGUOUS_BGR  # top-left sticker becomes unreadable
    colors, confidence = detect_face_colors(img)
    assert colors[0] is None
    assert confidence == 8 / 9


def test_detect_colors_returns_none_on_partial_scan():
    img = make_face_image(list("URFDLBURF"))
    img[0:60, 0:60] = AMBIGUOUS_BGR
    assert detect_colors(img) is None


def test_detect_colors_returns_letters_on_clean_scan():
    assert detect_colors(make_face_image(list("URFDLBURF"))) == list("URFDLBURF")


def test_undecodable_bytes_are_reported_not_guessed():
    colors, confidence = detect_face_colors(b"not an image at all")
    assert colors == [None] * 9
    assert confidence == 0.0


def test_missing_file_is_reported():
    colors, confidence = detect_face_colors("/no/such/file.jpg")
    assert colors == [None] * 9
    assert confidence == 0.0


def test_detect_cube_state_requires_six_faces():
    faces = [make_face_image(letter * 9) for letter in "URFDLB"]
    assert detect_cube_state(faces) == "U" * 9 + "R" * 9 + "F" * 9 + "D" * 9 + "L" * 9 + "B" * 9
    assert detect_cube_state(faces[:5]) is None


def test_color_statistics_shape():
    stats = get_color_statistics(make_face_image(list("URFDLBURF")))
    assert len(stats) == 9
    assert set(next(iter(stats.values()))) == {"h", "s", "v"}
