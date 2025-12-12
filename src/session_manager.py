import os
import shutil
import time
import csv
import uuid
from itertools import cycle
from typing import List, Tuple, Optional
from datetime import datetime
import gradio as gr # Needed for gr.update, gr.Warning, gr.Info, gr.Error

from .data_fetcher import read_hacker_news_rss, format_published_time
from .model_trainer import (
    authenticate_hf,
    train_with_dataset,
    get_top_hits,
    load_embedding_model,
    upload_model_to_hub
)
from .config import AppConfig
from .vibe_logic import VibeChecker
from sentence_transformers import SentenceTransformer

class HackerNewsFineTuner:
    """
    Encapsulates all application logic and state for a single user session.
    """

    def __init__(self, config: AppConfig = AppConfig):
        # --- Dependencies ---
        self.config = config
        
        # --- Session Identification ---
        self.session_id = str(uuid.uuid4())
        
        # Define session-specific paths to allow simultaneous training
        self.session_root = self.config.ARTIFACTS_DIR / self.session_id
        self.output_dir = self.session_root / "embedding_gemma_finetuned"
        self.dataset_export_file = self.session_root / "training_dataset.csv"
        
        # Setup directories
        os.makedirs(self.output_dir, exist_ok=True)
        print(f"[{self.session_id}] New session started. Artifacts: {self.session_root}")

        # --- Application State ---
        self.model: Optional[SentenceTransformer] = None
        self.vibe_checker: Optional[VibeChecker] = None
        self.titles: List[str] = [] 
        self.last_hn_dataset: List[List[str]] = [] 
        self.imported_dataset: List[List[str]] = [] 

        # Authenticate once (global)
        authenticate_hf(self.config.HF_TOKEN)

    def _update_vibe_checker(self):
        """Initializes or updates the VibeChecker with the current model state."""
        if self.model:
            self.vibe_checker = VibeChecker(
                model=self.model,
                query_anchor=self.config.QUERY_ANCHOR,
                task_name=self.config.TASK_NAME
            )
        else:
            self.vibe_checker = None

    ## Data and Model Management ##

    def refresh_data_and_model(self) -> Tuple[List[str], str]:
        """
        Reloads model and fetches data.
        Returns:
            - List of titles (for the UI)
            - Status message string
        """
        print(f"[{self.session_id}] Reloading model and data...")

        self.last_hn_dataset = []
        self.imported_dataset = []

        # 1. Reload the base embedding model
        try:
            self.model = load_embedding_model(self.config.MODEL_NAME)
            self._update_vibe_checker()
        except Exception as e:
            error_msg = f"CRITICAL ERROR: Model failed to load. {e}"
            print(error_msg)
            self.model = None
            self._update_vibe_checker()
            return [], error_msg

        # 2. Fetch fresh news data
        news_feed, status_msg = read_hacker_news_rss(self.config)
        titles_out = []
        status_value: str = f"Ready. Session ID: {self.session_id[:8]}... | Status: {status_msg}"

        if news_feed is not None and news_feed.entries:
            titles_out = [item.title for item in news_feed.entries]
        else:
            titles_out = ["Error fetching news."]
            gr.Warning(f"Data reload failed. {status_msg}")

        self.titles = titles_out

        # Return raw list of titles + status text
        return self.titles, status_value

    # --- Import Dataset/Export ---
    def import_additional_dataset(self, file_path: str) -> str:
        if not file_path:
            return "Please upload a CSV file."
        new_dataset, num_imported = [], 0
        try:
            with open(file_path, 'r', newline='', encoding='utf-8') as f:
                reader = csv.reader(f)
                try:
                    header = next(reader)
                    # Simple heuristic to detect if header exists
                    if not (header and header[0].lower().strip() == 'anchor'):
                        f.seek(0)
                except StopIteration:
                    return "Error: Uploaded file is empty."

                for row in reader:
                    if len(row) == 3:
                        new_dataset.append([s.strip() for s in row])
                        num_imported += 1
            if num_imported == 0:
                raise ValueError("No valid rows found.")
            self.imported_dataset = new_dataset
            return f"Imported {num_imported} triplets."
        except Exception as e:
            return f"Import failed: {e}"

    def export_dataset(self) -> Optional[str]:
        if not self.last_hn_dataset:
            gr.Warning("No dataset generated yet.")
            return None
        
        file_path = self.dataset_export_file
        try:
            with open(file_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['Anchor', 'Positive', 'Negative'])
                writer.writerows(self.last_hn_dataset)
            gr.Info(f"Dataset exported.")
            return str(file_path)
        except Exception as e:
            gr.Error(f"Export failed: {e}")
            return None

    def download_model(self) -> Optional[str]:
        if not os.path.exists(self.output_dir):
            gr.Warning("No model trained yet.")
            return None
        
        timestamp = int(time.time())
        try:
            base_name = self.session_root / f"model_finetuned_{timestamp}"
            archive_path = shutil.make_archive(
                base_name=str(base_name),
                format='zip',
                root_dir=self.output_dir,
            )
            gr.Info(f"Model zipped.")
            return archive_path
        except Exception as e:
            gr.Error(f"Zip failed: {e}")
            return None

    def upload_model(self, repo_name: str, oauth_token_str: str) -> str:
        """
        Calls the model trainer upload function using the session's output directory.
        """
        if not os.path.exists(self.output_dir):
            return "❌ Error: No trained model found in this session. Run training first."
        if not repo_name.strip():
            return "❌ Error: Please specify a repository name."
            
        return upload_model_to_hub(self.output_dir, repo_name, oauth_token_str)


    ## Training Logic ##
    def _create_hn_dataset(self, pos_ids: List[int], neg_ids: List[int]) -> List[List[str]]:
        """
        Creates triplets (Anchor, Positive, Negative) from the selected indices.
        Uses cycling to balance the dataset if the number of positives != negatives.
        """
        if not pos_ids or not neg_ids:
            return []

        # Convert indices to actual title strings
        pos_titles = [self.titles[i] for i in pos_ids]
        neg_titles = [self.titles[i] for i in neg_ids]

        dataset = []

        # We need to pair every Positive with a Negative.
        # Strategy: Iterate over the longer list and cycle through the shorter list
        # to ensure every selected item is used at least once and the dataset is balanced.
        
        if len(pos_titles) >= len(neg_titles):
            # More positives than negatives: Iterate positives, reuse negatives
            neg_cycle = cycle(neg_titles)
            for p_title in pos_titles:
                dataset.append([self.config.QUERY_ANCHOR, p_title, next(neg_cycle)])
        else:
            # More negatives than positives: Iterate negatives, reuse positives
            pos_cycle = cycle(pos_titles)
            for n_title in neg_titles:
                dataset.append([self.config.QUERY_ANCHOR, next(pos_cycle), n_title])

        return dataset

    def training(self, pos_ids: List[int], neg_ids: List[int]) -> str:
        """
        Main training entry point.
        Args:
            pos_ids: Indices of stories marked as "Favorite"
            neg_ids: Indices of stories marked as "Dislike"
        """
        if self.model is None:
             raise gr.Error("Model not loaded.")
        
        # Validation
        if not pos_ids:
            raise gr.Error("Please select at least one 'Favorite' story.")
        if not neg_ids:
            raise gr.Error("Please select at least one 'Dislike' story.")
        
        # Generate Dataset
        hn_dataset = self._create_hn_dataset(pos_ids, neg_ids)
        
        # Merge with imported dataset if it exists
        if self.imported_dataset:
            # If we have both, combine them
            self.last_hn_dataset = hn_dataset + self.imported_dataset
        else:
            self.last_hn_dataset = hn_dataset
                    
        if not self.last_hn_dataset:
            raise gr.Error("Dataset generation failed (Empty dataset).")

        def semantic_search_fn() -> str:
            return get_top_hits(model=self.model, target_titles=self.titles, task_name=self.config.TASK_NAME, query=self.config.QUERY_ANCHOR)

        result = "### Search (Before):\n" + f"{semantic_search_fn()}\n\n"
        print(f"[{self.session_id}] Starting Training with {len(self.last_hn_dataset)} examples...")
        
        train_with_dataset(
            model=self.model, 
            dataset=self.last_hn_dataset, 
            output_dir=self.output_dir, 
            task_name=self.config.TASK_NAME, 
            search_fn=semantic_search_fn
        )
        
        self._update_vibe_checker()
        print(f"[{self.session_id}] Training Complete.")

        result += "### Search (After):\n" + f"{semantic_search_fn()}"
        return result

    def is_model_tuned(self) -> bool:
        return True if self.last_hn_dataset else False

    ## Vibe Check Logic ##
    def get_vibe_check(self, news_text: str) -> Tuple[str, str, gr.update]:
        info_text = f"**Session:** {self.session_id[:6]}<br>**Model:** `{self.config.MODEL_NAME}`{' - Fine-tuned' if self.last_hn_dataset else ''}"

        if not self.vibe_checker:
            return "N/A", "Model Loading...", gr.update(value=self._generate_vibe_html("gray")), info_text
        if not news_text or len(news_text.split()) < 3:
            return "N/A", "Text too short", gr.update(value=self._generate_vibe_html("white")), info_text

        try:
            vibe_result = self.vibe_checker.check(news_text)
            status = vibe_result.status_html.split('>')[1].split('<')[0]
            return f"{vibe_result.raw_score:.4f}", status, gr.update(value=self._generate_vibe_html(vibe_result.color_hsl)), info_text
        except Exception as e:
            return "N/A", f"Error: {e}", gr.update(value=self._generate_vibe_html("gray")), info_text

    def _generate_vibe_html(self, color: str) -> str:
        return f'<div style="background-color: {color}; height: 100px; border-radius: 12px; border: 2px solid #ccc;"></div>'

    ## Mood Reader Logic ##
    def fetch_and_display_mood_feed(self) -> str:
        if not self.vibe_checker:
            return "Model not ready. Please wait or reload."
        
        feed, status = read_hacker_news_rss(self.config)
        if not feed or not feed.entries:
            return f"**Feed Error:** {status}"

        scored_entries = []
        for entry in feed.entries:
            title = entry.get('title')
            if not title: continue
            
            vibe_result = self.vibe_checker.check(title)
            scored_entries.append({
                "title": title,
                "link": entry.get('link', '#'),
                "comments": entry.get('comments', '#'),
                "published": format_published_time(entry.published_parsed),
                "mood": vibe_result
            })

        scored_entries.sort(key=lambda x: x["mood"].raw_score, reverse=True)

        model_name = "<unsaved>"
        if self.last_hn_dataset:
            model_name = f"./{self.output_dir}"

        md = (f"## Hacker News Top Stories\n"
              f"**Session:** {self.session_id[:6]}<br>"
              f"**Base Model:** `{self.config.MODEL_NAME}`<br>"
              f"**Tuned Model:** `{model_name}`<br>"
              f"**Updated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
              "| Vibe | Score | Title | Comments | Published |\n|---|---|---|---|---|\n")
        
        for item in scored_entries:
            md += (f"| {item['mood'].status_html} "
                   f"| {item['mood'].raw_score:.4f} "
                   f"| [{item['title']}]({item['link']}) "
                   f"| [Comments]({item['comments']}) "
                   f"| {item['published']} |\n")
        return md
