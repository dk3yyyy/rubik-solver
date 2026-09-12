# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- A scanned frame is read from the cube in front of the camera. The sampler took
  the bounding box of the largest four-sided contour and, finding none, fell back
  to the whole picture, so on a real frame the nine "stickers" were patches of
  wall, desk and shirt. A frame that holds no readable cube face is now reported
  as such, instead of being turned into nine stickers and blamed on the centre
  colour.
- A cube that is not held dead square is read correctly. The grid is fitted to a
  face-sized quadrilateral when one is found, and otherwise searched over a few
  sizes and small rotations of the middle of the frame, so a cube filling the
  picture at an angle no longer has its edge stickers sampled from the
  background.

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
