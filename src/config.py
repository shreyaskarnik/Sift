import os
from typing import Final
from pathlib import Path

ARTIFACTS_DIR: Final[Path] = Path("artifacts")

class AppConfig:
    """Central configuration for the Sift training pipeline."""

    ARTIFACTS_DIR: Final[Path] = ARTIFACTS_DIR
    HF_TOKEN: Final[str | None] = os.getenv('HF_TOKEN')

    # --- Model/Training ---
    MODEL_NAME: Final[str] = 'google/embeddinggemma-300m'
    TASK_NAME: Final[str] = "Classification"
