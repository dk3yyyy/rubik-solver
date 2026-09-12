# Backend FastAPI Code Review

**Files reviewed:** `main.py`, `solver.py`, `validator.py`, `webcam.py`, `tests/test_api.py`, `tests/conftest.py`

---

## 1. /api/scramble — Correctness

| Aspect | Status | Notes |
|--------|--------|-------|
| GET + POST both registered | ✅ | Correct per contract |
| Returns `{scramble, state}` | ✅ | Matches response model |
| Scramble length = 20 moves | ✅ | Tested in `test_scramble_works_over_get_and_post` |
| State is valid facelet | ✅ | Verified via `validate_facelet` |
| Handles solver unavailable (503) | ✅ | `_require_solver()` + `None` check on `random_scramble()` |

**Minor issue:** `random_scramble()` avoids consecutive same-face moves but does not produce uniformly random states. The distribution is biased away from sequences with cancellations (e.g., R R' never appears, but also R L R is slightly more likely than truly random). Not a bug, but scrambles are not "random-state" quality.

---

## 2. /api/solve — Error Handling

| Scenario | Status | HTTP | Notes |
|----------|--------|------|-------|
| Format error (bad chars, wrong length) | ✅ | 400 | Via `_validate()` → `check_facelet` FORMAT branch |
| Unsolvable cube (twisted corner, etc.) | ✅ | 422 | Via `check_solvable` UNSOLVABLE branch |
| Solver returns `None` (depth exceeded) | ✅ | 422 | Line 191 |
| Solver returns wrong answer | ✅ | 500 | Verified by applying moves + `is_solved()` check |
| Already-solved cube (empty solution) | ✅ | 200 | Returns `solution=""`, `move_count=0` |
| Solver unavailable | ✅ | 503 | `_require_solver()` at entry |
| `apply_moves` returns `None` | ✅ | 500 | Line 195-196 |

**No issues found.** The self-verification of the solver's answer (lines 197-203) is a strong defensive pattern.

---

## 3. /api/validate — Logic

| Aspect | Status | Notes |
|--------|--------|-------|
| Does not require solver tables | ✅ | Confirmed by design — `check_facelet` is pure Python |
| Returns `{valid, error}` | ✅ | `ValidateResponse` model matches |
| Format errors → `valid: false` with message | ✅ | Does not raise HTTPException, returns 200 with `valid: false` |
| Unsolvable → `valid: false` with message | ✅ | Correct distinction from `/api/solve` (which would 422) |

**No issues found.** Correctly designed as a "soft check" that never raises on bad input.

---

## 4. Missing Endpoints

| Missing | Severity | Notes |
|---------|----------|-------|
| `GET /api/health` or `GET /api/status` | **Medium** | Clients cannot probe solver availability before submitting work. Forces a 503 on the first real call to discover status. |
| No OpenAPI tags | Low | All endpoints appear ungrouped in `/docs`. Cosmetic only. |
| No `GET /` root endpoint | Low | Returns 404. Could return a small JSON with available endpoints. |

---

## 5. Security Issues

### 5.1 — File Upload Size Limit (Medium)
**Location:** `/api/detect` (line 299-311)

```python
async def detect_single_face(file: UploadFile = File(...)) -> DetectResponse:
    detector = _require_webcam()
    colors, confidence = detector.detect_face_colors(await file.read())
```

**Problem:** No `max_length` on `File(...)`. A malicious client can upload a multi-gigabyte file, exhausting memory when `await file.read()` loads it entirely into RAM.

**Fix:** Use `File(default=None, max_length=10_000_000)` or stream the file to a temp location.

### 5.2 — Base64 Image Size Limit (Medium)
**Location:** `/api/webcam-scan` (line 246-296), `_decode_base64_image` (line 151)

**Problem:** No size limit on decoded bytes. Base64 inflates ~33%, so a 15MB JSON payload could decode to ~12MB of image data per face, ×6 faces = ~72MB allocated in memory per request.

**Fix:** Add a length check after `base64.b64decode()` or limit the `Request` body size via middleware.

### 5.3 — No Rate Limiting (Medium)
**Problem:** No rate limiting on solver endpoints. A single client can saturate the CPU with `/api/solve` calls (solver is CPU-bound).

### 5.4 — Permissive CORS (Low — intentional)
```python
allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
```
Documented as intentional for an unauthenticated public API. No issue if that is the design intent.

### 5.5 — Input Validation on `facelet: object` (Low)
**Location:** `validator.py` line 112, `solver.validate(facelet: object)`

**Problem:** Accepts `object` — passing a non-string (e.g., a dict) will fail gracefully inside `check_format()`, but the type hint is overly broad. Not exploitable.

---

## 6. CORS Configuration

| Setting | Value | Assessment |
|---------|-------|------------|
| `allow_origins` | `["*"]` | ✅ Correct for public API; comment in code explains the mutual exclusion with credentials |
| `allow_credentials` | `False` | ✅ Required per CORS spec when origin is `*` |
| `allow_methods` | `["*"]` | ⚠️ Permissive — allows DELETE, PATCH, PUT even though the app only defines GET/POST. Low risk since no handlers exist for those methods. |
| `allow_headers` | `["*"]` | ✅ Standard for public APIs |

**Assessment:** Configuration is internally consistent and correctly implemented. The wildcard-without-credentials combination is the only valid way to allow all origins.

---

## 7. Minor Code Issues

### 7.1 — Redundant Normalization
`main.py:143` calls `_normalize(state)` then passes to `check_facelet()`. `validator.py:136` in `check_solvable()` also calls `facelet.strip().upper()`. Harmless but redundant.

### 7.2 — Dead Code in webcam_scan (line 289)
```python
state = "".join(color for color in face_colors if color is not None)
```
The `if unmatched:` check at line 283 already raises 422 if any color is `None`, so the `if color is not None` filter is never reached with `None` values.

### 7.3 — `StepRequest.step` No Upper Bound
`Field(ge=0)` allows arbitrarily large integers. The endpoint correctly bounds-checks against `total` at line 227, so no bug, but a `Field(ge=0, le=100)` would produce clearer client errors.

### 7.4 — `os` Import Placement
`os` is imported at the top of `main.py` (line 21) but only used in the `if __name__ == "__main__"` block. Not an error, but could be moved for clarity.

### 7.5 — Confidence Division Safety
Line 273: `(sum(scores) / len(scores)) * (detected / len(face_colors))` — `len(face_colors)` could theoretically be 0, but the earlier `if not payloads` guard (line 256) ensures at least one payload, and the loop always appends 9 entries per payload. Safe but fragile to future refactors.

---

## 8. Test Coverage Assessment

| Area | Covered | Notes |
|------|---------|-------|
| Scramble GET+POST | ✅ | Both methods tested |
| Solve happy path | ✅ | Including already-solved cube |
| Solve legacy `facelet` field | ✅ | `test_solve_still_accepts_the_legacy_facelet_field` |
| Solve self-verification failure | ✅ | Monkeypatch test for bad solver output |
| Validate pass/fail | ✅ | Both format and unsolvable cases |
| Step happy path | ✅ | First and last step |
| Step out-of-range | ✅ | Returns 400 |
| Webcam scan partial | ✅ | Correctly rejects < 6 faces |
| Webcam scan > 6 faces | ✅ | Returns 400 |
| Webcam scan bad base64 | ✅ | Returns 400 |
| Detect single face | ✅ | File upload path |
| **Solver unavailable (503)** | ❌ | No test for when `solver.is_ready()` returns False |
| **Large input rejection** | ❌ | No test for oversized uploads |
| **CORS headers** | ❌ | No test verifying CORS headers in response |
| **Health endpoint** | N/A | Does not exist |

---

## Summary

**What works well:**
- Clean separation between validation (pure Python), solver wrapping (defensive readiness checks), and API layer
- Excellent self-verification in `/api/solve` — applies the solution and confirms it solves the cube before returning
- Correct HTTP status code semantics (400/422/503) throughout
- Good error messages propagated from validator to API response
- Pydantic models enforce response shape

**Action items (by priority):**

1. **Add file upload size limit** on `/api/detect` — `File(..., max_length=...)`
2. **Add request body size limit** for `/api/webcam-scan` (e.g., 20MB total)
3. **Add a `/api/health` endpoint** returning solver readiness status
4. **Add rate limiting** on solver endpoints to prevent CPU exhaustion
5. **Add tests** for the 503 path (mock `solver.is_ready()` to return False)
6. **Consider narrowing CORS `allow_methods`** to `["GET", "POST", "OPTIONS"]`
7. **Remove dead code** on line 289 of `main.py` (the `if color is not None` filter)
