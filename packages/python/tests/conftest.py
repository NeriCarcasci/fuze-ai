"""Shared fixtures for Fuze AI tests."""
from __future__ import annotations

import sys
from pathlib import Path
import pytest

SRC_PATH = Path(__file__).resolve().parents[1] / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from fuze_ai import reset_config


@pytest.fixture(autouse=True)
def reset_global_config():
    """Reset global config state between tests."""
    reset_config()
    yield
    reset_config()
