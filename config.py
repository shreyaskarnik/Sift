import os
from typing import Final
from pathlib import Path

# --- Base Directory Definition ---
# Use Path for modern, OS-agnostic path handling
ARTIFACTS_DIR: Final[Path] = Path("artifacts")

class AppConfig:
    """
    Central configuration class for the Hacker News Fine-Tuner application.
    """

    # --- Directory/Environment Configuration ---
    ARTIFACTS_DIR: Final[Path] = ARTIFACTS_DIR

    # Environment variable for Hugging Face token (used by model_trainer)
    HF_TOKEN: Final[str | None] = os.getenv('HF_TOKEN')


    # --- Caching/Data Fetching Configuration ---
    HN_RSS_URL: Final[str] = "https://news.ycombinator.com/rss"

    # Filename for the pickled cache data (using Path.joinpath)
    CACHE_FILE: Final[Path] = ARTIFACTS_DIR.joinpath("hacker_news_cache.pkl")

    # Cache duration set to 30 minutes (1800 seconds)
    CACHE_DURATION_SECONDS: Final[int] = 60 * 30


    # --- Model/Training Configuration ---

    # Name of the pre-trained embedding model
    MODEL_NAME: Final[str] = 'google/embeddinggemma-300M'

    # Task name for prompting the embedding model (e.g., for instruction tuning)
    TASK_NAME: Final[str] = "Classification"

    # Output directory for the fine-tuned model
    OUTPUT_DIR: Final[Path] = ARTIFACTS_DIR.joinpath("embedding-gemma-finetuned-hn")


    # --- Gradio/App-Specific Configuration ---

    # Anchor text used for contrastive learning dataset generation
    QUERY_ANCHOR: Final[str] = "MY_FAVORITE_NEWS"

    # Number of titles shown for user selection in the Gradio interface
    TOP_TITLES_COUNT: Final[int] = 10

    # Default export path for the dataset CSV
    DATASET_EXPORT_FILENAME: Final[Path] = ARTIFACTS_DIR.joinpath("training_dataset.csv")

    # Default model for the standalone Mood Reader tab
    DEFAULT_MOOD_READER_MODEL: Final[str] = "bebechien/embedding-gemma-finetuned-hn"

