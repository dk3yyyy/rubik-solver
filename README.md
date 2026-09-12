# Rubik's Cube Solver

A full-stack web application that solves Rubik's cubes using a Three.js 3D frontend and a FastAPI backend powered by a Kociemba-inspired two-phase solver.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
  - [POST /api/scramble](#post-apiscramble)
  - [POST /api/solve](#post-apisolve)
  - [POST /api/step](#post-apistep)
  - [POST /api/webcam-scan](#post-apiwebcam-scan)
- [Using the App](#using-the-app)
- [Configuration](#configuration)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

This project is an interactive Rubik's cube solver web application. Users can scramble a virtual cube, run the solver to generate a solution, step through the solution one move at a time, and even scan a physical cube via the device camera to import its state.

### Features

- **3D Interactive Cube** — drag to rotate, click to twist faces (Three.js)
- **Random Scramble** — generates legal, random cube states
- **Two-Phase Solver** — solves any valid cube state in ≤ 22 moves
- **Step-by-Step Playback** — animate the solution one move at a time
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
│   │   ├── cube-logic.js        # Move notation, facelet grid, optimiser
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

1. **Open the app** — navigate to `http://localhost:5173` in your browser.
2. **Scramble** — click the **Scramble** button to generate a random cube state. The 3D cube updates instantly.
3. **Solve** — click **Solve** to run the solver. The solution appears in the move list.
4. **Step through** — use the **◀** and **▶** buttons to advance through the solution one move at a time. Each step animates the 3D cube.
5. **Reset** — click **Reset** to return the cube to the solved state.
6. **Webcam scan** — click **Scan Cube**, grant camera permission, point the camera at each face of your physical cube as prompted, and the app imports the state automatically.

### Keyboard shortcuts

| Key        | Action              |
|------------|---------------------|
| `S`        | Scramble            |
| `Enter`    | Solve               |
| `→`        | Next step           |
| `←`        | Previous step       |
| `R`        | Reset to solved     |

---

## Configuration

### Environment variables

| Variable                | Default         | Description                                |
|-------------------------|-----------------|--------------------------------------------|
| `BACKEND_HOST`          | `0.0.0.0`       | Host the backend binds to                  |
| `BACKEND_PORT`          | `8000`          | Port the backend listens on                |
| `VITE_API_URL`          | `http://localhost:8000` | API base URL used by the frontend  |
| `SOLVER_MAX_MOVES`      | `22`            | Upper bound on solution length             |
| `WEBCAM_RESOLUTION`     | `1280x720`      | Requested webcam capture resolution        |

Copy `.env.example` to `.env` in both `backend/` and `frontend/` to customize these values.

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
