"""Synthetic cube-face images for the webcam tests.

Each face is a 3x3 grid of solid colour cells; the BGR values are chosen so
that OpenCV maps them into the hue bands the detector expects.
"""

import base64
from typing import List, Optional, Sequence

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


def jpeg_roundtrip(img: np.ndarray, quality: int = 90) -> np.ndarray:
    """The frame as the scanner actually receives it.

    The browser sends ``canvas.toDataURL('image/jpeg')`` and the endpoint
    decodes it, so a frame that never went through JPEG is not quite the same
    input. Tests that check what the sampler does with a *frame* - rather than
    with one crop - use this.
    """
    ok, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return cv2.imdecode(buffer, cv2.IMREAD_COLOR)


def base64_face(letters: Sequence[str]) -> str:
    return base64.b64encode(jpeg_bytes(make_face_image(letters))).decode()


def solved_faces() -> List[str]:
    """One base64 image per face, in U, R, F, D, L, B order.

    Real frames rather than cropped sticker sheets: a scan reads a camera
    picture of a cube, and the sampler refuses a sheet of flat colour with no
    face in it. ``base64_face`` is still there for the sticker classifier.
    """
    return [base64_frame(letter * 9, coverage=0.6) for letter in "URFDLB"]


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
    gap: int = 5,
    centre=(None, None),
    side: Optional[int] = None,
    brightness: float = 1.0,
    noise: float = 0.0,
) -> np.ndarray:
    """A camera frame: a desk, optional background quads, and one cube face.

    ``coverage`` is the share of the shorter frame side the face spans, so 0.7
    is a cube held close and filling most of the picture, and 0.2 is one held at
    arm's length. ``side`` overrides it in pixels, for a face held so close it
    is bigger than the frame. ``quads`` are (corners, BGR) pairs drawn behind
    the cube, for testing that scenery does not get read as the face. ``gap`` is
    the plastic between the stickers, and 0 is a face whose stickers touch,
    which is the worst case for telling a face from a patch of flat colour.
    ``centre`` moves the face off the middle of the frame, (`None`, `None`)
    being the middle. ``brightness`` and ``noise`` are exposure and sensor
    noise, for frames that are not evenly lit.

    This is the one place frames are built: the adversarial harness in the
    sandbox imports it rather than carrying its own copy, after a second copy
    drifted far enough to hide a real defect behind a passing test.
    """
    height, width = frame_size
    img = np.full((height, width, 3), background, dtype=np.uint8)

    for corners, colour in quads:
        cv2.fillConvexPoly(img, np.array(corners, dtype=np.int32), colour)

    size = int(min(height, width) * coverage) if side is None else int(side)
    patch = make_face_patch(letters, size=180, gap=gap)
    centre_x = width / 2 if centre[0] is None else centre[0]
    centre_y = height / 2 if centre[1] is None else centre[1]
    half = size / 2
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

    if brightness != 1.0:
        img = np.clip(img.astype(np.float32) * brightness, 0, 255).astype(np.uint8)
    if noise:
        rng = np.random.default_rng(1)
        img = np.clip(img.astype(np.float32) + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    return img


def make_corner_frame(front: Sequence[str], top: Sequence[str], *, side: int = 300,
                      skew=(90, 70), frame_size=(480, 640), centre=(None, None),
                      gap: int = 5) -> np.ndarray:
    """A cube held corner-on, so the camera sees two faces at once.

    ``front`` is the face square to the camera, ``top`` the one receding from
    its top edge: a normal way to hold a cube, and a frame in which the front
    face is not the biggest thing in the picture.
    """
    height, width = frame_size
    img = np.full((height, width, 3), 70, dtype=np.uint8)
    centre_x = width / 2 if centre[0] is None else centre[0]
    centre_y = height / 2 if centre[1] is None else centre[1]
    half = side / 2
    x0, y0, x1, y1 = centre_x - half, centre_y - half, centre_x + half, centre_y + half
    source = np.array([[0, 0], [179, 0], [179, 179], [0, 179]], dtype=np.float32)

    for letters, quad in (
        (front, np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)),
        (top, np.array([[x0, y0], [x1, y0], [x1 + skew[0], y0 - skew[1]],
                        [x0 + skew[0], y0 - skew[1]]], dtype=np.float32)),
    ):
        patch = make_face_patch(letters, size=180, gap=gap)
        matrix = cv2.getPerspectiveTransform(source, quad)
        warped = cv2.warpPerspective(patch, matrix, (width, height))
        mask = cv2.warpPerspective(np.full((180, 180), 255, dtype=np.uint8), matrix, (width, height))
        img[mask > 0] = warped[mask > 0]
    return img


def make_tiled_frame(*, tile: int = 80, grout: int = 5, colour=(200, 220, 230),
                     frame_size=(480, 640)) -> np.ndarray:
    """A tiled floor or bathroom wall: nine flat cells between dark lines.

    Scenery that looks like a face at a glance, and the reason the sampler
    checks whether the pattern carries on past the crop.
    """
    height, width = frame_size
    img = np.full((height, width, 3), colour, dtype=np.uint8)
    for x in range(0, width, tile):
        img[:, x:x + grout] = (30, 30, 30)
    for y in range(0, height, tile):
        img[y:y + grout, :] = (30, 30, 30)
    return img


def make_window_frame(*, frame_size=(480, 640)) -> np.ndarray:
    """A bright window: panes between dark mullions, which read as stickers."""
    height, width = frame_size
    img = np.full((height, width, 3), 240, dtype=np.uint8)
    img[:, 200:210] = (20, 20, 20)
    img[:, 420:430] = (20, 20, 20)
    img[150:160, :] = (20, 20, 20)
    img[310:320, :] = (20, 20, 20)
    return img


def make_framed_tiling_frame(*, block_origin=(240, 160), tile: int = 80, grout: int = 5,
                            thickness: int = 3, margin: int = 8,
                            frame_size=(480, 640)) -> np.ndarray:
    """A tiled surface with a rectangle drawn around a 3x3 block of it.

    The rectangle gives the edge detector a quadrilateral to take the crop from,
    and the tiling carries on outside it: a window frame, a picture frame, the
    bezel of a monitor or a printed panel round a grid of flat cells. Every one
    of those was read as nine confident stickers while the continuation check was
    applied only to crops taken from a square window - the defect of #30, and the
    frame that made the scan answer with a cube state for a picture of a wall.

    The plain margin keeps the drawn line clear of the tiling's own grout: a line
    drawn along the grout merges with it, no quadrilateral is found at all, and
    the frame is then refused for a reason that has nothing to do with this.
    """
    height, width = frame_size
    block = 3 * tile
    bx, by = block_origin
    colour = (200, 220, 230)
    img = make_tiled_frame(tile=tile, grout=grout, frame_size=(height, width))
    img[by - margin:by + block + margin, bx - margin:bx + block + margin] = colour
    img[by:by + block, bx:bx + block] = make_tiled_frame(
        tile=tile, grout=grout, frame_size=(block, block)
    )
    img[by - thickness:by, bx - thickness:bx + block + thickness] = (10, 10, 10)
    img[by + block:by + block + thickness, bx - thickness:bx + block + thickness] = (10, 10, 10)
    img[by - thickness:by + block + thickness, bx - thickness:bx] = (10, 10, 10)
    img[by - thickness:by + block + thickness, bx + block:bx + block + thickness] = (10, 10, 10)
    return img


def base64_frame(letters: Sequence[str], **kwargs) -> str:
    """A full camera frame, as the scanner receives it, base64 JPEG."""
    return base64.b64encode(jpeg_bytes(make_frame(letters, **kwargs))).decode()


def base64_framed_tiling(**kwargs) -> str:
    """A framed tiling frame, as the scanner receives it, base64 JPEG."""
    return base64.b64encode(jpeg_bytes(make_framed_tiling_frame(**kwargs))).decode()
