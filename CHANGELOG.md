# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
