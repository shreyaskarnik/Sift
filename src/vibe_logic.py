from dataclasses import dataclass
from math import floor
from typing import List
from sentence_transformers import SentenceTransformer, util

# --- Data Structures ---

@dataclass(frozen=True)
class VibeThreshold:
    """Defines a threshold for a Vibe status."""
    score: float
    status: str

@dataclass(frozen=True)
class VibeResult:
    """Stores the calculated HSL color and status for a given score."""
    raw_score: float
    status_html: str  # Pre-formatted HTML for display
    color_hsl: str    # Raw HSL color string

# Define the status thresholds from highest score to lowest score
VIBE_THRESHOLDS: List[VibeThreshold] = [
    VibeThreshold(score=0.8, status="✨ VIBE:HIGH"),
    VibeThreshold(score=0.5, status="👍 VIBE:GOOD"),
    VibeThreshold(score=0.2, status="😐 VIBE:FLAT"),
    VibeThreshold(score=0.0, status="👎 VIBE:LOW"),  # Base case for scores < 0.2
]

# --- Utility Functions ---

def map_score_to_vibe(score: float) -> VibeResult:
    """
    Maps a cosine similarity score to a VibeResult containing status, HTML, and color.
    """
    # 1. Clamp score for safety
    clamped_score = max(0.0, min(1.0, score))

    # 2. Color Calculation
    hue = floor(clamped_score * 120)  # Linear interpolation: 0 (Red) -> 120 (Green)
    color_hsl = f"hsl({hue}, 80%, 50%)"

    # 3. Status Determination
    status_text: str = VIBE_THRESHOLDS[-1].status  # Default to the lowest status
    for threshold in VIBE_THRESHOLDS:
        if clamped_score >= threshold.score:
            status_text = threshold.status
            break

    # 4. Create the pre-formatted HTML for display
    status_html = f"<span style='color: {color_hsl}; font-weight: bold;'>{status_text}</span>"

    return VibeResult(raw_score=score, status_html=status_html, color_hsl=color_hsl)


# --- Core Logic Class ---

class VibeChecker:
    """
    Handles similarity scoring using a SentenceTransformer model and a pre-set anchor query.
    """
    def __init__(self, model: SentenceTransformer, query_anchor: str, task_name: str):
        self.model = model
        self.query_anchor = query_anchor
        self.task_name = task_name

        # Pre-calculate the anchor embedding for efficiency
        self.query_embedding = self.model.encode(
            self.query_anchor,
            prompt_name=self.task_name,
            normalize_embeddings=True
        )

    def check(self, text: str) -> VibeResult:
        """
        Calculates the "vibe" of a given text against the pre-configured anchor.
        """
        title_embedding = self.model.encode(
            text,
            prompt_name=self.task_name,
            normalize_embeddings=True
        )
        # Use dot product for similarity with normalized embeddings
        score: float = util.dot_score(self.query_embedding, title_embedding).item()

        return map_score_to_vibe(score)
