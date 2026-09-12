# Rubik's Cube Solver

A full-stack web application that solves Rubik's cubes using a Three.js 3D frontend and a FastAPI backend powered by a Kociemba-inspired two-phase solver.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [Quick start: the whole app on one origin](#quick-start-the-whole-app-on-one-origin)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
  - [GET /api/health](#get-apihealth)
  - [POST /api/scramble](#post-apiscramble)
  - [POST /api/solve](#post-apisolve)
  - [POST /api/step](#post-apistep)
  - [POST /api/webcam-scan](#post-apiwebcam-scan)
- [Using the App](#using-the-app)
- [Configuration](#configuration)
- [Hosting](#hosting)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

This project is an interactive Rubik's cube solver web application. Users can scramble a virtual cube, run the solver to generate a solution, step through the solution one move at a time, and even scan a physical cube via the device camera to import its state.

### Features

- **Guided cube entry** — tap a colour, then tap the stickers on a six-face net to type in a scrambled physical cube
- **Move prediction** — the moment the cube is filled in, the app reports how many moves the solution takes
- **Learner-friendly playback** — a speed slider from 0.1s to 3s per move, Next and Prev for stepping one move at a time, and the move to turn next highlighted in the solution list
- **3D Interactive Cube** — drag to rotate, click to twist faces (Three.js)
- **Random Scramble** — generates legal, random cube states
- **Two-Phase Solver** — solves any valid cube state in ≤ 22 moves
- **Webcam Cube Scanning** — detect a physical cube via camera and import its state
- **Responsive UI** — works on desktop and mobile browsers

---

## Architecture

```
┌─────────────────────┐      HTTP / JSON       ┌─────────────────────┐
│                     │ ◀──────────────────────▶ │                     │
│   Frontend          │      (FastAPI)          │   Backend           │
│   React + Three.js  │                         │   FastAPI + Python  │
│                     │                         │                     │
│  ┌───────────────┐  │                         │  ┌───────────────┐  │
│  │  CubeRenderer │  │                         │  │  SolverEngine │  │
│  │  (Three.js)   │  │                         │  │  (Kociemba)   │  │
│  └───────────────┘  │                         │  └───────────────┘  │
│  ┌───────────────┐  │                         │  ┌───────────────┐  │
│  │  CameraInput  │  │                         │  │  ColorDetect  │  │
│  │  (getUserMedia)│ │                         │  │  (OpenCV)     │  │
│  └───────────────┘  │                         │  └───────────────┘  │
└─────────────────────┘                         └─────────────────────┘
```

- **Backend** — Python 3.11+, FastAPI, `rubik-solver-py` (Kociemba two-phase solver), OpenCV for colour detection
- **Frontend** — vanilla JavaScript with Three.js (loaded from CDN) and Vite; no framework or build step beyond bundling
- **Communication** — REST JSON over HTTP; no WebSocket or real-time channel required

---

## Prerequisites

| Dependency | Version  | Notes                          |
|------------|----------|--------------------------------|
| Python     | ≥ 3.11   | Required for backend           |
| Node.js    | ≥ 18     | Required for frontend          |
| npm        | ≥ 9      | Bundled with Node.js           |
| pip        | ≥ 23     | Bundled with Python            |
| Browser    | Any modern browser with WebGL & `getUserMedia` support | Chrome, Firefox, Edge, Safari 16+ |

> **Note for macOS / Linux users:** Ensure `python3` and `python3-venv` are installed. Some Linux distributions require `libgl1` for OpenCV (`sudo apt install libgl1`).

> **Note on NumPy:** `requirements.txt` asks for `numpy>=2.1`. NumPy 1.26 has no wheels for Python 3.13 and later, and a source build on 3.14 corrupts the solver's pruning-table construction, so `init_solver()` fails and every solver endpoint answers `503`. If you must stay on Python 3.12 or older and pin NumPy yourself, the solver still needs 2.1 or newer.

---

## Setup

### Quick start: the whole app on one origin

The backend serves the built frontend when `frontend/dist` exists, so a single
command runs everything:

```bash
cd frontend
npm install
npm run build          # once, and again after any frontend change

cd ../backend
python3 -m venv venv
source venv/bin/activate      # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000**. The page and the API share an origin, so
there is no proxy, no `VITE_API_URL` and nothing cross-origin to get wrong. This
is the way to run the app for real; keep reading only if you also want hot reload
while editing the frontend.

> Hosting the frontend somewhere else does not work as a way to solve cubes.
> Browsers block a page served from a public origin from calling a backend on
> your own machine (Chrome reports `LocalNetworkAccessPermissionDenied`), and the
> server cannot opt out of that. The public copy of this app is a demo of the
> interface; solving needs the backend above.

### Backend

```bash
cd backend

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate      # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`. Visit `http://localhost:8000/docs` for the interactive Swagger UI.

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend dev server runs at `http://localhost:5173` by default. It proxies `/api` requests to the backend at `http://localhost:8000` (configured in `vite.config.js`), so the frontend talks to the backend on the same origin.

---

## Project Structure

```
rubik-solver/
├── backend/
│   ├── main.py                  # FastAPI app & route definitions
│   ├── solver.py                # Kociemba solver wrapper and readiness checks
│   ├── validator.py             # Facelet format and solvability validation
│   ├── webcam.py                # OpenCV colour classification
│   ├── requirements.txt         # Python dependencies
│   ├── requirements-dev.txt     # Test dependencies
│   └── tests/
│       ├── test_api.py
│       ├── test_solver.py
│       ├── test_validator.py
│       └── test_webcam.py
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.js              # App, Three.js renderer, UI wiring
│   │   ├── cube-logic.js        # Move notation, facelet grid, palette, optimiser
│   │   ├── cube-input.js        # Guided sticker-by-sticker entry panel
│   │   └── styles.css
│   └── test/
│       ├── cube-logic.test.js
│       └── facelets.json        # Expected facelets generated from the solver
│
├── README.md
└── .gitignore
```

---

## Testing

### Backend

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest tests
```

Covers facelet validation, the solver wrapper, and the API contract. The first run builds the solver tables (a few seconds); later runs load them from `~/.cache/rubik_solver`.

### Frontend

```bash
cd frontend
npm test
```

Checks the move notation, the facelet-to-3D grid mapping, and the move optimiser against expected facelets generated from the Python solver, so the animated cube and the solution text can never disagree.

---

## API Documentation

All endpoints accept and return `JSON`. The base URL is `http://localhost:8000`.

### GET `/api/health`

Liveness for a platform health check, and a quick manual look at a deployed
service. Answers 200 as soon as the app is up, which is before the solver tables
have finished building.

**Response body:**
```json
{
  "status": "ok",
  "solver_ready": true,
  "webcam_available": true
}
```
| Field | Type | Description |
| `status` | `string` | `"ok"` when the app is serving |
| `solver_ready` | `boolean` | `false` while the solver tables are still building; solving returns 503 until it is `true` |
| `webcam_available` | `boolean` | `false` when OpenCV is not installed, so scanning returns 503 |

### POST `/api/scramble`

Generates a random, valid cube state and the scramble sequence that produces it.

**Request body:** None.

**Response body:**

```json
{
  "scramble": "R U R' F' D2 L' B U2",
  "state": "DUUBULDBF..."
}
```

| Field     | Type     | Description                                          |
|-----------|----------|------------------------------------------------------|
| `scramble` | `string` | Space-separated move notation (e.g., `R U R' F' D2`) |
| `state`    | `string` | 54-character cube state string (standard face order) |

---

### POST `/api/solve`

Solves a given cube state and returns the optimal (or near-optimal) solution.

**Request body:**

```json
{
  "state": "DUUBULDBF..."
}
```

| Field   | Type     | Description                                                  |
|---------|----------|--------------------------------------------------------------|
| `state` | `string` | 54-character cube state string; use the output of `/scramble` |

**Response body:**

```json
{
  "solution": "R U2 R' F' D L'",
  "move_count": 7,
  "solved_state": "UUUUUUUUUR..."
}
```

| Field          | Type     | Description                                     |
|----------------|----------|-------------------------------------------------|
| `solution`     | `string` | Space-separated solution moves                  |
| `move_count`   | `int`    | Number of moves in the solution (HTM)           |
| `solved_state` | `string` | Cube state after applying the solution          |

**Error responses:**

| Status | Condition                    |
|--------|------------------------------|
| `400`  | Invalid state string length  |
| `422`  | Unsolvable cube state        |
| `500`  | Solver internal error        |

---

### POST `/api/step`

Returns a single move from the solution at a given step index (for step-by-step playback).

**Request body:**

```json
{
  "state": "DUUBULDBF...",
  "step": 2
}
```

| Field   | Type     | Description                                |
|---------|----------|--------------------------------------------|
| `state` | `string` | Current cube state                         |
| `step`  | `int`    | Zero-indexed step into the solution        |

**Response body:**

```json
{
  "move": "U2",
  "new_state": "DUUBULDBF...",
  "step": 2,
  "total_steps": 7,
  "is_complete": false
}
```

| Field         | Type      | Description                                      |
|---------------|-----------|--------------------------------------------------|
| `move`        | `string`  | The move at this step                            |
| `new_state`   | `string`  | Cube state after applying the move               |
| `step`        | `int`     | Current step index                               |
| `total_steps` | `int`     | Total moves in the solution                      |
| `is_complete` | `boolean` | `true` if this is the last move in the solution  |

---

### POST `/api/webcam-scan`

Accepts base64-encoded face images from the device camera and returns the detected cube state. Send six images in U, R, F, D, L, B order for a full 54-sticker state, or one `image` per request while scanning face by face.

**Request body:**

```json
{
  "images": [
    "data:image/jpeg;base64,/9j/4AAQ...",
    "data:image/jpeg;base64,/9j/4AAQ..."
  ]
}
```

| Field    | Type       | Description                                                |
|----------|------------|------------------------------------------------------------|
| `images` | `string[]` | One base64 image per face, in U, R, F, D, L, B order       |
| `image`  | `string`   | A single base64 image, used when only one face is supplied  |

**Response body:**

```json
{
  "state": "DUUBULDBF...",
  "confidence": 0.94,
  "face_colors": ["U", "R", "..."]
}
```

| Field          | Type       | Description                                            |
|----------------|------------|--------------------------------------------------------|
| `state`        | `string`   | Detected 54-character cube state                       |
| `confidence`   | `number`   | Fraction of stickers classified, times detection confidence (0.0 – 1.0) |
| `face_colors`  | `string[]` | Per-sticker detected facelet letters (54 elements)      |

Returns `422` when a sticker cannot be classified or the detected state is not solvable, rather than guessing a colour.

> **Tip:** For best detection results, hold the cube under even lighting and ensure each face fills the camera frame clearly. The detector works best when the cube face is perpendicular to the camera.

---

## Using the App

The usual flow is to type in the cube you are holding, then follow the solution on screen.

1. **Open the app** at `http://localhost:8000` with the backend running (or `http://localhost:5173` if you are running the Vite dev server).
2. **Enter your cube** — in the **Enter your cube** section, hold the physical cube white on top and
   green facing you. Pick a colour, then tap the stickers that match it on the six-face net. The
   centre stickers are fixed because they define the colours. The 3D cube above updates as you go.
3. **Read the prediction** — once all 54 stickers are set the app solves the cube automatically and
   reports the number of moves, for example `21 moves`.
4. **Follow along** — set the speed slider to something you can keep up with, then press **Play** to
   watch the solution run in real time. The move to turn next is highlighted in the solution list and
   the ones already done are dimmed, so there is nothing to count. Press **Pause** at any point and
   **Play** again to carry on.
5. **Or step through manually** — **Next** applies a single move, **Prev** takes it back, so you can
   match each move on the real cube before moving on. The highlight follows you either way.
6. **Fix mistakes** — if you tapped a sticker wrong, pick the colour again and re-tap it, or use the
   **clear** swatch to empty it. The prediction updates when the cube is complete again.

Random practice is available too: **Scramble** generates a legal random state, and **Solve** finds
its solution. You can also paste a 54-character facelet string, or use **Scan with webcam** to read
a face at a time; a scan is loaded into the net so you can correct any sticker it got wrong.

### Keyboard shortcuts

| Key        | Action                                   |
|------------|------------------------------------------|
| `S`        | Scramble                                 |
| `Enter`    | Solve the current cube                   |
| `→`        | Next step                                |
| `←`        | Previous step                            |
| `U D L R F B` | Turn that face clockwise              |
| `u d l r f b` | Turn that face anticlockwise           |

---

## Configuration

### Environment variables

| Variable                | Default         | Description                                |
|-------------------------|-----------------|--------------------------------------------|
| `BACKEND_HOST`          | `0.0.0.0`       | Host the backend binds to                  |
| `BACKEND_PORT`          | `8000`          | Port the backend listens on                |
| `VITE_API_URL`          | *(empty, same origin)* | API base URL used by the frontend  |
| `SOLVER_MAX_MOVES`      | `22`            | Upper bound on solution length             |
| `WEBCAM_RESOLUTION`     | `1280x720`      | Requested webcam capture resolution        |

Copy `.env.example` to `.env` in both `backend/` and `frontend/` to customize these values.

---

## Hosting

The solver is Python, so a static host cannot run it. GitHub Pages, Cloudflare
Pages and a static Vercel build can each serve `frontend/dist`, and each will
render the cube, the guided entry and the playback controls. None of them can
answer `/api/solve`, and a page served from a public origin is not allowed to
call a backend running on the visitor's own machine, so a copy hosted that way
cannot solve a cube and says so when you try.

Hosting a working app needs somewhere that runs Python. `render.yaml` is set up
for Render: choose **New**, then **Blueprint**, in the dashboard, point it at this
repository, and Render installs the backend dependencies, builds the frontend and
starts a single service that serves both. One service means one origin, which is
why there is no `VITE_API_URL` to set and no CORS to arrange.

Free plan services sleep when idle, so the first request after a quiet spell
waits for a cold start plus the few seconds the solver tables need. `GET
/api/health` reports both: it returns 200 as soon as the app is up, with
`solver_ready` telling you whether solving will work yet.

Anywhere that runs a Python process or a container works the same way: install
`backend/requirements.txt`, run `npm ci && npm run build` in `frontend` so
`frontend/dist` exists, then `cd backend && uvicorn main:app --host 0.0.0.0
--port $PORT`.

Cloudflare Workers and Vercel's Python functions are a poor fit rather than an
impossible one: the solver builds its pruning tables at startup, which costs
seconds and tens of megabytes, and that sits badly with a short-lived function.
Workers cannot run this dependency set at all.

---

## Development

### Running tests

```bash
# Backend tests
cd backend
pytest tests/ -v

# Frontend tests
cd frontend
npm run test
```

### Building for production

```bash
# Build frontend static assets
cd frontend
npm run build       # outputs to frontend/dist/

# Run backend with production settings
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Linting

```bash
# Backend
cd backend
ruff check .
mypy solver/ webcam/

# Frontend
cd frontend
npx eslint src/
```

---

## Roadmap

- [ ] **Android app** — native Android port using Kotlin + OpenGL ES for offline solving
- [ ] **Optimal solver** — integrate `optimal-kociemba` for guaranteed God's Number (≤ 20) solutions
- [ ] **Pattern database visualization** — interactive visualization of the pruning tables used by the two-phase solver
- [ ] **Multi-language UI** — i18n support for EN, ZH, ES, FR, DE
- [ ] **Speed-cubing timer** — built-in inspection timer + session statistics
- [ ] **Blindfolded solver** — Old Pochmann / M2 mode with voice-guided execution

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
