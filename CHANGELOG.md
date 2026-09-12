# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- A crop of one sticker is not read as a whole face. The boundary between two
  stickers is tested by asking how much of the crossing strip the plastic
  covers, not by asking whether the strip contains a dark pixel: on a face
  filling 82% of the frame at a 21 degree tilt the plastic ring *around* the
  middle sticker crossed the end of all four boundary strips, so the count read
  4 of 4, the flatness check 9 of 9, and the sampler answered "L L L L L L L L L"
  at confidence 1.0 from a 134 px window holding one sticker - a plausible cube
  state read off a quarter of the frame. A boundary now has to run across the
  strip it is measured in.
- A scanned frame is read from the cube in front of the camera. The sampler took
  the bounding box of the largest four-sided contour and, finding none, fell back
  to the whole picture, so on a real frame the nine "stickers" were patches of
  wall, desk and shirt. A frame that holds no readable cube face is now reported
  as such, instead of being turned into nine stickers and blamed on the centre
  colour.
- A cube that is not held dead square is read correctly. A face-sized
  quadrilateral is straightened by perspective when one is found, and sought
  otherwise over positions, sizes and small rotations. The rotations the
  detected stickers suggest are tried at every position too, so a tilted face
  held in the middle of the frame is read rather than refused: the tilt used to
  be carried by the sticker lattice alone, which is only sought near a sticker.
- A crop that shows a row of desk above two rows of face is refused. The
  continuation check skipped its own probe when the crop sat against the frame
  edge, because it threw away any band less than 30% on frame - and a crop
  pushed up against the edge is exactly where a row of background gets inside
  it. Wood is close to the orange of the R and L stickers, so the read was
  plausible and confident. A thin band running the full width of the crop is
  thousands of pixels and is compared now.
- Plastic between the stickers is scored as a share close to a face's own rather
  than as "more is better". A crop sitting on the junction of four stickers is
  nearly half plastic and reads a blend of the four colours; rewarding its
  plastic let it outrank the face.

### Changed
- The frame sampler searches the whole picture for the face, not the middle of
  it. A cube held off centre, at arm's length or against a bright desk used to be
  refused, or read from whatever the middle of the frame happened to be: the
  search now starts from every four-sided shape the edge detector finds, wherever
  it is.
- A frame is only read as a face when it shows the structure of one: nine cells
  that read as cube colours, the boundaries between the stickers visible at the
  thirds of the crop, and the same nine colours when the sampling grid moves a
  little. Nine flat cells with dark lines between them is also what a tiled
  floor, a radiator grille or a window looks like, so a crop whose pattern
  carries on past its own edge is refused - a face ends, scenery does not.
- Frames are read at a working size of 480 px on the short side, which keeps a
  1080p frame from costing more than three times a VGA one.
- The live face-detection overlay (`/api/detect-frame`) answers with the same
  sampler the scan uses, so it can no longer mark a frame ready that the scan
  then refuses.
- `detect_face_colors` is documented as the sticker classifier for an
  already-cropped face; `analyse_face` is the frame reader.

### Added
- `backend/tools/scan_frame_diag.py` — read saved camera frames through the same
  code the endpoint runs, print the nine stickers it makes of each one and why,
  and write a marked-up crop showing where it sampled.
- `Dockerfile` — multi-stage build that compiles the frontend and produces a
  single Python image serving both the API and the built UI.
- `docker-compose.yml` — one-command self-hosted deployment of the full stack
  on port 8000.
- `.dockerignore` — keeps the build context to the source files the image
  actually needs.
- `CHANGELOG.md` — this file.
- OpenAPI tags on every backend endpoint (`health`, `cube`, `scan`), so the
  Swagger UI at `/docs` groups routes by category.

## [1.0.0] - 2026-09-12

### Added
- FastAPI backend with a Kociemba two-phase solver: `/api/scramble`,
  `/api/solve`, `/api/validate`, `/api/step`.
- Webcam cube scanning via OpenCV: `/api/webcam-scan`, `/api/detect`,
  `/api/detect/single`.
- Three.js 3D frontend with guided cube entry, move playback and a
  speed slider.
- Rate limiting, CORS configuration and a `/api/health` liveness probe.
- Render blueprint (`render.yaml`) for one-service deployment.
