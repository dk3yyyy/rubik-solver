"""API contract tests for the FastAPI app."""

import pytest
from fastapi.testclient import TestClient

from helpers import base64_face, solved_faces
from main import app
from validator import validate_facelet

SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def scrambled_state(client) -> str:
    response = client.get("/api/scramble")
    assert response.status_code == 200
    return response.json()["state"]


def twisted_cube() -> str:
    broken = list(SOLVED)
    broken[8], broken[9], broken[20] = broken[20], broken[8], broken[9]
    return "".join(broken)


def test_scramble_works_over_get_and_post(client):
    for method in (client.get, client.post):
        response = method("/api/scramble")
        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"scramble", "state"}
        assert len(body["scramble"].split()) == 20
        assert validate_facelet(body["state"])[0] is True


def test_solve_returns_solution_count_and_solved_state(client):
    response = client.post("/api/solve", json={"state": scrambled_state(client)})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"solution", "move_count", "solved_state"}
    assert body["move_count"] == len(body["solution"].split())
    assert body["solved_state"] == SOLVED


def test_solve_still_accepts_the_legacy_facelet_field(client):
    response = client.post("/api/solve", json={"facelet": scrambled_state(client)})
    assert response.status_code == 200


def test_already_solved_cube_needs_no_moves(client):
    response = client.post("/api/solve", json={"state": SOLVED})
    assert response.status_code == 200
    body = response.json()
    assert body["move_count"] == 0
    assert body["solution"] == ""
    assert body["solved_state"] == SOLVED


def test_malformed_state_is_400(client):
    response = client.post("/api/solve", json={"state": "UUU"})
    assert response.status_code == 400


def test_unsolvable_state_is_422(client):
    response = client.post("/api/solve", json={"state": twisted_cube()})
    assert response.status_code == 422
    assert "twist" in response.json()["detail"].lower()


def test_validate_accepts_and_rejects(client):
    assert client.post("/api/validate", json={"state": SOLVED}).json() == {
        "valid": True,
        "error": None,
    }
    rejected = client.post("/api/validate", json={"state": "U" * 54}).json()
    assert rejected["valid"] is False
    assert rejected["error"]


def test_validate_does_not_500_on_missing_solver_path(client):
    # Regression: the unsolvable branch used response_model field "detail"
    # instead of "error", which made pydantic raise while building the reply.
    response = client.post("/api/validate", json={"state": twisted_cube()})
    assert response.status_code == 200
    assert response.json()["valid"] is False


def test_step_matches_the_solution(client):
    state = scrambled_state(client)
    solution = client.post("/api/solve", json={"state": state}).json()
    moves = solution["solution"].split()

    first = client.post("/api/step", json={"state": state, "step": 0})
    assert first.status_code == 200
    assert first.json()["move"] == moves[0]
    assert first.json()["total_steps"] == len(moves)

    last = client.post("/api/step", json={"state": state, "step": len(moves) - 1}).json()
    assert last["is_complete"] is True
    assert last["new_state"] == SOLVED


def test_step_out_of_range_is_400(client):
    state = scrambled_state(client)
    assert client.post("/api/step", json={"state": state, "step": 999}).status_code == 400


def test_step_accepts_the_legacy_facelet_field(client):
    state = scrambled_state(client)
    response = client.post("/api/step", json={"facelet": state, "step": 0})
    assert response.status_code == 200


def test_step_on_solved_cube_is_422(client):
    assert client.post("/api/step", json={"state": SOLVED, "step": 0}).status_code == 422


def test_webcam_scan_requires_an_image(client):
    assert client.post("/api/webcam-scan", json={}).status_code == 400


def test_webcam_scan_needs_all_six_faces(client):
    response = client.post("/api/webcam-scan", json={"images": [base64_face("U" * 9)]})
    assert response.status_code == 422
    assert "54" in response.json()["detail"]


def test_webcam_scan_accepts_a_single_image_field(client):
    response = client.post("/api/webcam-scan", json={"image": base64_face("U" * 9)})
    assert response.status_code == 422


def test_webcam_scan_reads_a_complete_solved_cube(client):
    response = client.post("/api/webcam-scan", json={"images": solved_faces()})
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == SOLVED
    assert body["confidence"] == 1.0
    assert len(body["face_colors"]) == 54


def test_webcam_scan_rejects_bad_base64(client):
    response = client.post("/api/webcam-scan", json={"images": ["!!not base64!!"]})
    assert response.status_code == 400


def test_detect_single_face_upload(client):
    from helpers import jpeg_bytes, make_face_image

    response = client.post(
        "/api/detect/single",
        files={"file": ("face.jpg", jpeg_bytes(make_face_image(list("URFDLBURF"))), "image/jpeg")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["facelet"] == "URFDLBURF"
    assert body["confidence"] == 1.0
