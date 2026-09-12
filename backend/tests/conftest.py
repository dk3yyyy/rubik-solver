"""Make the backend package and this test directory importable."""

import pathlib
import sys

import pytest

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))
sys.path.insert(0, str(_HERE))


@pytest.fixture(autouse=True)
def _own_rate_limit_budget():
    """Give each test its own rate-limit budget.

    The limiter counts per client across the whole suite, so without this the
    tests later in a file start answering 429 and the failures look unrelated to
    the limiter. Clearing the store leaves the limiter switched on, so the tests
    that exercise it still do.
    """
    import main

    main._rate_limit_store.clear()
    yield
    main._rate_limit_store.clear()
