"""Read saved camera frames and report what the scanner makes of each one.

When a scan fails on someone's desk and the frame is not available to debug, this
is how to get it: save the frames the browser captured, then run them through the
same code the endpoint runs. It prints the nine stickers, the crop the scanner
chose and why, and writes a marked-up copy showing where it sampled.

Usage:
    python backend/tools/scan_frame_diag.py frame1.jpg frame2.jpg ...
    python backend/tools/scan_frame_diag.py /path/to/folder --output /tmp/scan

Exit status is 1 when any frame was refused, so it can gate a script.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from webcam import (  # noqa: E402
    _centre_square,
    _rotated,
    analyse_face,
    warp_face,
    _quad_candidates,
)

FACE_ORDER = ("U", "R", "F", "D", "L", "B")
SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def gather(paths: list[str]) -> list[Path]:
    found: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            found.extend(
                sorted(p for p in path.iterdir() if p.suffix.lower() in SUFFIXES)
            )
        elif path.exists():
            found.append(path)
        else:
            print(f"skipping {raw}: no such file or directory")
    return found


def crop_for(img: np.ndarray, result: dict) -> np.ndarray:
    """Rebuild the crop the scanner settled on, so it can be marked up."""
    if result["source"] == "quad":
        quad = _quad_candidates(img)
        if quad is not None:
            return warp_face(img, quad)
    square = _centre_square(img, result["scale"] or 0.6)
    return _rotated(square, result["angle"])


def mark(img: np.ndarray) -> np.ndarray:
    """Circle the nine points the scanner read."""
    marked = img.copy()
    height, width = marked.shape[:2]
    cell_h, cell_w = height // 3, width // 3
    for row in range(3):
        for col in range(3):
            cx = col * cell_w + cell_w // 2
            cy = row * cell_h + cell_h // 2
            cv2.circle(marked, (cx, cy), max(4, min(cell_h, cell_w) // 10), (255, 0, 255), -1)
    return marked


def report(path: Path, output: Path | None) -> bool:
    img = cv2.imread(str(path))
    if img is None:
        print(f"\n{path.name}: could not be decoded as an image")
        return False

    result = analyse_face(img)
    height, width = img.shape[:2]
    print(f"\n{path.name}  ({width}x{height})")
    stickers = " ".join(colour or "?" for colour in result["colours"])
    print(f"  nine stickers : {stickers}")
    print(f"  centre        : {result['colours'][4]}")
    print(
        "  crop          : source=%s scale=%.2f angle=%.0f  (face quad covered %.0f%% of the frame)"
        % (result["source"] or "-", result["scale"], result["angle"], 100 * result["coverage"])
    )
    print(f"  found         : {result['found']}  confidence={result['confidence']}")
    if result["reason"]:
        print(f"  refused       : {result['reason']}")

    if result["found"] and result["colours"][4] in FACE_ORDER:
        position = FACE_ORDER.index(result["colours"][4])
        print(f"  would be sent as frame {position + 1} ({result['colours'][4]})")

    if output is not None:
        output.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output / f"crop-{path.name}"), mark(crop_for(img, result)))
        print(f"  crop written  : {output / f'crop-{path.name}'}")

    return bool(result["found"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="image files or directories of frames")
    parser.add_argument(
        "--output", "-o", type=Path, default=None,
        help="directory to write the marked-up crops into",
    )
    args = parser.parse_args()

    frames = gather(args.paths)
    if not frames:
        print("no frames to read")
        return 1

    read = 0
    for path in frames:
        if report(path, args.output):
            read += 1

    print(f"\n{read} of {len(frames)} frame(s) could be read as a cube face")
    return 0 if read == len(frames) else 1


if __name__ == "__main__":
    raise SystemExit(main())
