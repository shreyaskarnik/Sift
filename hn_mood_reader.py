# hn_mood_reader.py

import feedparser
from datetime import datetime
from dataclasses import dataclass
from typing import List
import os

# Assuming these are in separate files as in the original structure
from config import AppConfig
from data_fetcher import format_published_time
from vibe_logic import VibeChecker, VibeResult

# --- Data Structures ---
@dataclass(frozen=True)
class FeedEntry:
    """Stores necessary data for a single HN story, including its calculated mood."""
    title: str
    link: str
    comments_link: str
    published_time_str: str
    mood: VibeResult

# --- Core Logic Class ---
class HnMoodReader:
    """Handles model initialization and mood scoring for Hacker News titles."""
    def __init__(self, model_name: str):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise ImportError("Please install 'sentence-transformers'") from e
        
        print(f"Initializing SentenceTransformer with model: {model_name}...")
        self.model = SentenceTransformer(model_name, truncate_dim=128)
        print("Model initialized successfully.")
        
        self.vibe_checker = VibeChecker(
            model=self.model,
            query_anchor=AppConfig.QUERY_ANCHOR,
            task_name=AppConfig.TASK_NAME
        )
        self.model_name = model_name

    def _get_mood_result(self, title: str) -> VibeResult:
        """Calculates the mood for a title using the VibeChecker."""
        return self.vibe_checker.check(title)

    def fetch_and_score_feed(self) -> List[FeedEntry]:
        """Fetches, scores, and sorts entries from the HN RSS feed."""
        feed = feedparser.parse(AppConfig.HN_RSS_URL)
        if feed.bozo:
            raise IOError(f"Error parsing feed from {AppConfig.HN_RSS_URL}.")

        scored_entries: List[FeedEntry] = []
        for entry in feed.entries:
            title, link = entry.get('title'), entry.get('link')
            if not title or not link:
                continue
            
            scored_entries.append(
                FeedEntry(
                    title=title,
                    link=link,
                    comments_link=entry.get('comments', '#'),
                    published_time_str=format_published_time(entry.published_parsed),
                    mood=self._get_mood_result(title)
                )
            )

        scored_entries.sort(key=lambda x: x.mood.raw_score, reverse=True)
        return scored_entries
