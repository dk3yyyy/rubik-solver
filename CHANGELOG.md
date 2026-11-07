# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- A frame the cube fills most of is no longer read a cell out of step (issue
  #33). At 80-90% coverage and a 21-32 degree tilt the search accepted a window
  shifted one cell sideways, so its first column was the wall - which the
  classifier calls white - and its other two were the face's first two columns,
  answering `UURUDLUUR` at confidence 1.0 for a scrambled face. Two things were
  wrong. `_worst_cell_background` sliced the nine cell interiors and then
  reshaped that non-contiguous view, so `reshape(9, -1)` grouped pixels by
  memory order instead of by cell, and a window holding a whole cell of wall
  measured 0.375 instead of 1.0 - the gate that exists to refuse exactly this
  crop under-reported by two thirds. And the dead-centre seed kept the single
  best size scored at angle 0, which on a tilted face is a coin toss, because no
  size shows internal lines there; at 0.9 coverage it chose the 0.28 window (a
  third of the face) and the aligned crop at the face's own size and tilt was
  never generated. Cells are grouped with the transpose `_crop_stats` already
  used, and there is now one dead-centre seed per grid size. Measured on the
  228-frame battery: 202 right / 16 refused / 10 wrong becomes 222 right / 6
  refused / 0 wrong, with no frame that read right becoming refused or wrong.
  All eight frames in the issue are read correctly.
- A crop whose worst cell is three quarters room is no longer read as stickers.
  The background gate's limit was 0.75 and the comparison was strict, so a cell
  that was 75% wall passed, and a random sweep of 240 frames found four
  confident-wrong reads whose worst cell measured 0.711-0.75 against a worst
  legitimate crop of 0.55. At 0.65 the four are read right or refused and the
  228-frame battery keeps every one of its right reads.
- The API answers a cube whose centres carry a different colour scheme. The
  validator accepts a relabelled cube (a whole-cube rotation) but the solver
  read the raw letters, solved a different cube than the one described, and the
  self-check turned that into a 500 for a valid input; a rotated *solved* cube
  was handed a 16-move "solution" instead of being called solved.
- A solver whose table build failed at startup is retried. Only the lifespan
  call ever ran `init_solver`, so one transient failure during a deploy left
  every solver endpoint answering 503 until the process restarted; the retry is
  locked against concurrent requests and paced, so a permanently broken build
  is not rebuilt on every request.
- An empty or unreadable face upload is a 400, not a 500. `cv2.imdecode` raises
  on an empty buffer and nothing caught it. The upload is read with a bound now
  as well: the size check ran after the whole body had been read into memory,
  which is the opposite of what a limit is for.
- `/api/detect-frame` has a payload cap. The overlay polls it twice a second and
  it was the one image endpoint with no ceiling at all.
- The live overlay no longer throttles itself out of a scan. The limiter allows
  60 requests a minute per client and the overlay spends 120 a minute just
  looking at the camera, so half a minute into framing the capture's own calls
  answered 429 and the scan failed as though the cube were at fault.
- A 429 from the rate limiter reaches the browser with CORS headers. The limiter
  answers the request itself, and it sat outside `CORSMiddleware`, so a
  cross-origin page saw an opaque network failure instead of the message and
  `Retry-After` that say how long to wait.
- The frontend's finished features work. Copy Link wrote a `?s=<facelet>` link
  that nothing read on load; the inspection countdown announced "timer running"
  while the clock stayed at 00:00.00, because the timeout that started it was
  cleared by the countdown that ended; the Undo button and `Ctrl/Cmd+Z` had no
  listener and could never leave `disabled`; `prefers-reduced-motion` was read
  but never assigned, so moves always animated; the ao5/ao12/mo3 card painted
  only after a new solve; and Optimize replaced the list on screen while Play
  followed the old one.
- A palette switch no longer repaints the cube back to an earlier state. The
  remembered facelet did not follow hand-typed or stepped moves, so toggling
  colourblind mode after a few turns put the cube back to solved on screen and
  Copy Link shared that state.
- Scramble, Reset, Load and Clear stop playback. A scramble pressed mid-solve
  left the playback loop running, so its completion branch recorded a solve time
  for a solve the user had abandoned, and Scramble could replace the cube
  underneath a move still animating.
- A `/api/solve` reply that arrives after the entry has moved on is dropped. The
  prediction fires by itself shortly after the last sticker is painted, so a
  slow answer could become the solution for a different cube.
- An element with the `hidden` attribute is actually hidden.
  `.move-preview { display: flex }` outranked the user agent's rule, so an empty
  "Next:" bar sat under the controls on every page load.
- The phone layout keeps the theme and colourblind toggles. `.primary-nav {
  display: none }` at 900px took the whole header navigation with it, so dark
  mode and the colourblind palette were unreachable on phones and tablets.
- The page does not scroll sideways at 320px. The stickers' fixed width made the
  four-block cube net 28px wider than a 390px phone's content column, a bare
  `1fr` grid track kept a min-content floor that pushed the statistics row out at
  320px, and the five history buttons did not wrap; each is sized or wrapped to
  the column now.
- The webcam stream is released. Pressing "Scan with webcam" twice requested a
  second stream without stopping the first, so the camera light stayed on and the
  first stream was never released; a stream that resolved after the panel closed
  was still attached to it.
- The copy buttons work without `navigator.clipboard` (a plain-HTTP LAN origin
  has none), refuse to make a link from a half-filled cube, and the solve timer
  and statistics survive a corrupt or throwing `localStorage`.
- A step requested during playback stops the loop instead of double-counting the
  cursor, and clearing the move history clears the solution Play follows.
- A crop that holds a cell of the room behind the cube is not read as a face.
  Near the edge of its search window the accepted crop can be pushed against the
  frame border, and then the far side has no probe band left to answer the
  continuation check with, while the near side is the wall, the desk or the print
  the cube is in front of - which the classifier reads as stickers, because a
  grey wall and a white sticker are ten units apart and no colour threshold
  separates them. The frame is asked instead what part of it is behind the cube,
  and a crop with a whole cell of that in it is refused. Measured on the 160
  frame battery at the browser's encoding: two frames that master read confidently
  wrong are now read right or refused, and no frame master read right is refused
  or read wrong. The frames whose cells straddle the face's edge rather than
  holding the room measure the same as legitimate frames do, so this is the wrong
  instrument for those, and they still misread.
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
- A crop read from a detected quadrilateral goes through the continuation check
  like any other. The check was skipped unless the crop came from a square
  window, so a tiled surface was read as nine confident stickers as soon as
  anything four-sided was drawn round a 3x3 block of it: a window frame, a
  picture frame, a monitor bezel or a printed panel all hand the search the
  same outline a real face does. A quad says where the crop is, not that what
  it holds is a cube face. A cube held against a white wall is still read: the
  probe on a quadrilateral's rect asks the band beyond the crop for the next
  cell's boundary as well as its colour, which is what tells a wall the stickers
  match from a tiling that carries on (checked against 160 real frames, no frame
  the sampler used to read is refused now).
- The copy-link button, the inspection timer and the ao5/ao12 stats panel have
  the markup `main.js` has always looked up. `#btn-copy-link`,
  `#inspection-timer` and `#speedcubing-stats` arrived with the deep-link work
  and index.html never had the elements, so three finished features had no UI:
  the button now sits beside Copy in the move history actions, the countdown in
  the timer display carrying the class its stylesheet animates, and the stats
  panel is the `stats-panel` card the stylesheet already styled.

### Changed
- The per-client rate limit defaults to 240 requests a minute rather than 60.
  The old figure suited a person typing a cube in; it did not survive the live
  overlay, which polls `/api/detect-frame` twice a second while the camera is
  open and so spends twice the budget before the user has captured anything.
  Set `RATE_LIMIT_MAX` to put it back, or to 0 to turn the limiter off.
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
