import gradio as gr
import os
import shutil
import time
import csv
from itertools import cycle
from typing import List, Iterable, Tuple, Optional, Callable
from datetime import datetime

# Import modules
from data_fetcher import read_hacker_news_rss, format_published_time
from model_trainer import (
    authenticate_hf,
    train_with_dataset,
    get_top_hits,
    load_embedding_model
)
from config import AppConfig
from vibe_logic import VibeChecker
from sentence_transformers import SentenceTransformer

# --- Main Application Class ---

class HackerNewsFineTuner:
    """
    Encapsulates all application logic and state for the Gradio interface.
    Manages the embedding model, news data, and training datasets.
    """

    def __init__(self, config: AppConfig = AppConfig):
        # --- Dependencies ---
        self.config = config

        # --- Application State ---
        self.model: Optional[SentenceTransformer] = None
        self.vibe_checker: Optional[VibeChecker] = None
        self.titles: List[str] = [] # Top titles for user selection
        self.target_titles: List[str] = [] # Remaining titles for semantic search target pool
        self.number_list: List[int] = [] # [0, 1, 2, ...] for checkbox indexing
        self.last_hn_dataset: List[List[str]] = [] # Last generated dataset from HN selection
        self.imported_dataset: List[List[str]] = [] # Manually imported dataset

        # Setup
        os.makedirs(self.config.ARTIFACTS_DIR, exist_ok=True)
        print(f"Created artifact directory: {self.config.ARTIFACTS_DIR}")
        
        authenticate_hf(self.config.HF_TOKEN)

        # Load initial data on startup
        self._initial_load()

    def _initial_load(self):
        """Helper to run the refresh function once at startup."""
        print("--- Running Initial Data Load ---")
        self.refresh_data_and_model()
        print("--- Initial Load Complete ---")

    def _update_vibe_checker(self):
        """Initializes or updates the VibeChecker with the current model state."""
        if self.model:
            print("Updating VibeChecker instance with the current model.")
            self.vibe_checker = VibeChecker(
                model=self.model,
                query_anchor=self.config.QUERY_ANCHOR,
                task_name=self.config.TASK_NAME
            )
        else:
            self.vibe_checker = None

    ## Data and Model Management ##

    def refresh_data_and_model(self) -> Tuple[gr.update, gr.update]:
        """
        1. Reloads the embedding model to clear fine-tuning.
        2. Fetches fresh news data (from cache or web).
        3. Updates the class state and returns Gradio updates for the UI.
        """
        print("\n" + "=" * 50)
        print("RELOADING MODEL and RE-FETCHING DATA")

        # Reset dataset state
        self.last_hn_dataset = []
        self.imported_dataset = []

        # 1. Reload the base embedding model
        try:
            self.model = load_embedding_model(self.config.MODEL_NAME)
            self._update_vibe_checker()
        except Exception as e:
            gr.Error(f"Model load failed: {e}")
            self.model = None
            self._update_vibe_checker()
            return (
                gr.update(choices=[], label="Model Load Failed"),
                gr.update(value=f"CRITICAL ERROR: Model failed to load. {e}")
            )

        # 2. Fetch fresh news data
        news_feed, status_msg = read_hacker_news_rss(self.config)
        titles_out, target_titles_out = [], []
        status_value: str = f"Model and data reloaded. Status: {status_msg}. Click 'Run Fine-Tuning' to begin."

        if news_feed is not None and news_feed.entries:
            # Use constant for clarity
            titles_out = [item.title for item in news_feed.entries[:self.config.TOP_TITLES_COUNT]]
            target_titles_out = [item.title for item in news_feed.entries[self.config.TOP_TITLES_COUNT:]]
            print(f"Data reloaded: {len(titles_out)} selection titles, {len(target_titles_out)} target titles.")
        else:
            titles_out = ["Error fetching news, check console.", "Could not load feed.", "No data available."]
            gr.Warning(f"Data reload failed. Using error placeholders. Details: {status_msg}")

        self.titles = titles_out
        self.target_titles = target_titles_out
        self.number_list = list(range(len(self.titles)))

        # Return Gradio updates for CheckboxGroup and Textbox
        return (
            gr.update(
                choices=self.titles,
                label=f"Hacker News Top {len(self.titles)} (Select your favorites)"
            ),
            gr.update(value=status_value)
        )

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
                    if not (header and header[0].lower().strip() == 'anchor'):
                        f.seek(0)
                except StopIteration:
                    return "Error: Uploaded file is empty."

                for row in reader:
                    if len(row) == 3:
                        new_dataset.append([s.strip() for s in row])
                        num_imported += 1
            if num_imported == 0:
                raise ValueError("No valid [Anchor, Positive, Negative] rows found in the CSV.")
            self.imported_dataset = new_dataset
            return f"Successfully imported {num_imported} additional training triplets."
        except Exception as e:
            gr.Error(f"Import failed. Ensure the CSV format is: [Anchor, Positive, Negative]. Error: {e}")
            return "Import failed. Check console for details."

    def export_dataset(self) -> Optional[str]:
        if not self.last_hn_dataset:
            gr.Warning("No dataset has been generated from current selection yet. Please run fine-tuning first.")
            return None
        file_path = self.config.DATASET_EXPORT_FILENAME
        try:
            print(f"Exporting dataset to {file_path}...")
            with open(file_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['Anchor', 'Positive', 'Negative'])
                writer.writerows(self.last_hn_dataset)
            gr.Info(f"Dataset successfully exported to {file_path}")
            return str(file_path)
        except Exception as e:
            gr.Error(f"Failed to export the dataset to CSV. Error: {e}")
            return None

    def download_model(self) -> Optional[str]:
        if not os.path.exists(self.config.OUTPUT_DIR):
            gr.Warning(f"The model directory '{self.config.OUTPUT_DIR}' does not exist. Please run training first.")
            return None
        timestamp = int(time.time())
        try:
            base_name = os.path.join(self.config.ARTIFACTS_DIR, f"embedding_gemma_finetuned_{timestamp}")
            archive_path = shutil.make_archive(
                base_name=base_name,
                format='zip',
                root_dir=self.config.OUTPUT_DIR,
            )
            gr.Info(f"Model files successfully zipped to: {archive_path}")
            return archive_path
        except Exception as e:
            gr.Error(f"Failed to create the model ZIP file. Error: {e}")
            return None

    ## Training Logic ##
    def _create_hn_dataset(self, selected_ids: List[int]) -> Tuple[List[List[str]], str, str]:
        """
        Internal function to generate the [Anchor, Positive, Negative] triplets
        from the user's Hacker News title selection.
        Returns (dataset, favorite_title, non_favorite_title)
        """
        total_ids, selected_ids = set(self.number_list), set(selected_ids)
        non_selected_ids = total_ids - selected_ids
        is_minority = len(selected_ids) < (len(total_ids) / 2)

        anchor_ids, pool_ids = (non_selected_ids, list(selected_ids)) if is_minority else (selected_ids, list(non_selected_ids))

        def get_titles(anchor_id, pool_id):
            return (self.titles[pool_id], self.titles[anchor_id]) if is_minority else (self.titles[anchor_id], self.titles[pool_id])

        fav_idx = pool_ids[0] if is_minority else list(anchor_ids)[0]
        non_fav_idx = list(anchor_ids)[0] if is_minority else pool_ids[0]

        hn_dataset = []
        pool_cycler = cycle(pool_ids)
        for anchor_id in sorted(list(anchor_ids)):
            fav, non_fav = get_titles(anchor_id, next(pool_cycler))
            hn_dataset.append([self.config.QUERY_ANCHOR, fav, non_fav])

        return hn_dataset, self.titles[fav_idx], self.titles[non_fav_idx]

    def training(self, selected_ids: List[int]) -> str:
        """
        Generates a training dataset from user selection and runs the fine-tuning process.
        """
        if self.model is None:
             raise gr.Error("Training failed: Embedding model is not loaded.")
        if not selected_ids:
            raise gr.Error("You must select at least one title.")
        if len(selected_ids) == len(self.number_list):
            raise gr.Error("You can't select all titles; a non-favorite is needed.")

        hn_dataset, example_fav, _ = self._create_hn_dataset(selected_ids)
        self.last_hn_dataset = hn_dataset
        final_dataset = self.last_hn_dataset + self.imported_dataset
        if not final_dataset:
            raise gr.Error("Training failed: Final dataset is empty.")
        print(f"Combined dataset size: {len(final_dataset)} triplets.")

        def semantic_search_fn() -> str:
            return get_top_hits(model=self.model, target_titles=self.target_titles, task_name=self.config.TASK_NAME, query=self.config.QUERY_ANCHOR)

        result = "### Semantic Search Results (Before Training):\n" + f"{semantic_search_fn()}\n\n"
        print("-" * 50 + "\nStarting Fine-tuning...")
        train_with_dataset(model=self.model, dataset=final_dataset, output_dir=self.config.OUTPUT_DIR, task_name=self.config.TASK_NAME, search_fn=semantic_search_fn)
        self._update_vibe_checker()
        print("Fine-tuning Complete.\n" + "-" * 50)

        result += "### Semantic Search Results (After Training):\n" + f"{semantic_search_fn()}"
        return result

    ## Vibe Check Logic (Tab 2) ##
    def get_vibe_check(self, news_text: str) -> Tuple[str, str, gr.update]:
        if not self.vibe_checker:
            gr.Error("Model/VibeChecker not loaded.")
            return "N/A", "Model Error", gr.update(value=self._generate_vibe_html("gray"))
        if not news_text or len(news_text.split()) < 3:
            gr.Warning("Please enter a longer text for a meaningful check.")
            return "N/A", "Please enter text", gr.update(value=self._generate_vibe_html("white"))

        try:
            vibe_result = self.vibe_checker.check(news_text)
            status = vibe_result.status_html.split('>')[1].split('<')[0] # Extract text from HTML
            return f"{vibe_result.raw_score:.4f}", status, gr.update(value=self._generate_vibe_html(vibe_result.color_hsl))
        except Exception as e:
            gr.Error(f"Vibe check failed. Error: {e}")
            return "N/A", f"Processing Error: {e}", gr.update(value=self._generate_vibe_html("gray"))

    def _generate_vibe_html(self, color: str) -> str:
        return f'<div style="background-color: {color}; height: 100px; border-radius: 12px; border: 2px solid #ccc;"></div>'

    ## Mood Reader Logic (Tab 3) ##
    def fetch_and_display_mood_feed(self) -> str:
        if not self.vibe_checker:
            return "**FATAL ERROR:** The Mood Reader failed to initialize. Check console."
        
        feed, status = read_hacker_news_rss(self.config)
        if not feed or not feed.entries:
            return f"**An error occurred while fetching the feed:** {status}"

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

        md = (f"## Hacker News Top Stories (Model: `{self.config.MODEL_NAME}`{' - Fine-tuned' if self.last_hn_dataset else ''}) ⬇️\n"
              f"**Last Updated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
              "| Vibe | Score | Title | Comments | Published |\n|---|---|---|---|---|\n")
        
        for item in scored_entries:
            md += (f"| {item['mood'].status_html} "
                   f"| {item['mood'].raw_score:.4f} "
                   f"| [{item['title']}]({item['link']}) "
                   f"| [Comments]({item['comments']}) "
                   f"| {item['published']} |\n")
        return md
# 🤖 Embedding Gemma Modkit: Fine-Tuning and Mood Reader

    ## Gradio Interface Setup ##
    def build_interface(self) -> gr.Blocks:
        with gr.Blocks(title="EmbeddingGemma Modkit") as demo:
            gr.Markdown("# 🤖 EmbeddingGemma Modkit: Fine-Tuning and Mood Reader")
            gr.Markdown("This project provides a set of tools to fine-tune [EmbeddingGemma](https://huggingface.co/google/embeddinggemma-300m) to understand your personal taste in Hacker News titles and then use it to score and rank new articles based on their \"vibe\". The core idea is to measure the \"vibe\" of a news title by calculating the semantic similarity between its embedding and the embedding of a fixed anchor phrase, **`MY_FAVORITE_NEWS`**.<br>See [README](https://huggingface.co/spaces/google/embeddinggemma-modkit/blob/main/README.md) for more details.")
            with gr.Tab("🚀 Fine-Tuning & Evaluation"):
                self._build_training_interface()
            with gr.Tab("💡 News Vibe Check"):
                self._build_vibe_check_interface()
            with gr.Tab("📰 Hacker News Mood Reader"):
                self._build_mood_reader_interface()
        return demo

    def _build_training_interface(self):
        with gr.Column():
            gr.Markdown("## Fine-Tuning & Semantic Search\nSelect titles to fine-tune the model towards making them more similar to **`MY_FAVORITE_NEWS`**.")
            with gr.Row():
                favorite_list = gr.CheckboxGroup(self.titles, type="index", label=f"Hacker News Top {len(self.titles)}", show_select_all=True)
                output = gr.Textbox(lines=14, label="Training and Search Results", value="Click 'Run Fine-Tuning' to begin.")
            with gr.Row():
                clear_reload_btn = gr.Button("Clear & Reload Model/Data")
                run_training_btn = gr.Button("🚀 Run Fine-Tuning", variant="primary")
            gr.Markdown("--- \n ## Dataset & Model Management")
            gr.Markdown("To train on your own data, upload a CSV file with the following columns (no header required, or header ignored if present):\n1. **Anchor**: A fixed anchor phrase, `MY_FAVORITE_NEWS`.\n2. **Positive**: A title or contents that you like.\n3. **Negative**: A title or contents that you don't like.\n\nExample CSV Row:\n```\nMY_FAVORITE_NEWS,What is machine learning?,How to write a compiler from scratch.\n```")
            import_file = gr.File(label="Upload Additional Dataset (.csv)", file_types=[".csv"], height=50)
            with gr.Row():
                download_dataset_btn = gr.Button("💾 Export Last HN Dataset")
                download_model_btn = gr.Button("⬇️ Download Fine-Tuned Model")
            download_status = gr.Markdown("Ready.")
            with gr.Row():
                dataset_output = gr.File(label="Download Dataset CSV", height=50, visible=False, interactive=False)
                model_output = gr.File(label="Download Model ZIP", height=50, visible=False, interactive=False)

            run_training_btn.click(fn=self.training, inputs=favorite_list, outputs=output)
            clear_reload_btn.click(fn=self.refresh_data_and_model, inputs=None, outputs=[favorite_list, output], queue=False)
            import_file.change(fn=self.import_additional_dataset, inputs=[import_file], outputs=download_status)
            download_dataset_btn.click(lambda: [gr.update(value=None, visible=False), "Generating..."], None, [dataset_output, download_status], queue=False).then(self.export_dataset, None, dataset_output).then(lambda p: [gr.update(visible=p is not None, value=p), "CSV ready." if p else "Export failed."], [dataset_output], [dataset_output, download_status])
            download_model_btn.click(lambda: [gr.update(value=None, visible=False), "Zipping..."], None, [model_output, download_status], queue=False).then(self.download_model, None, model_output).then(lambda p: [gr.update(visible=p is not None, value=p), "ZIP ready." if p else "Zipping failed."], [model_output], [model_output, download_status])

    def _build_vibe_check_interface(self):
        with gr.Column():
            gr.Markdown(f"## News Vibe Check Mood Lamp\nEnter text to see its similarity to **`{self.config.QUERY_ANCHOR}`**.\n**Vibe Key:** Green = High, Red = Low")
            news_input = gr.Textbox(label="Enter News Title or Summary", lines=3)
            vibe_check_btn = gr.Button("Check Vibe", variant="primary")
            with gr.Row():
                vibe_color_block = gr.HTML(value=self._generate_vibe_html("white"), label="Mood Lamp")
                with gr.Column():
                    vibe_score = gr.Textbox(label="Cosine Similarity Score", value="N/A", interactive=False)
                    vibe_status = gr.Textbox(label="Vibe Status", value="Enter text and click 'Check Vibe'", interactive=False, lines=2)
            vibe_check_btn.click(fn=self.get_vibe_check, inputs=[news_input], outputs=[vibe_score, vibe_status, vibe_color_block])

    def _build_mood_reader_interface(self):
        with gr.Column():
            gr.Markdown(f"## Live Hacker News Feed Vibe\nThis feed uses the current model (base or fine-tuned) to score the vibe of live HN stories against **`{self.config.QUERY_ANCHOR}`**.")
            feed_output = gr.Markdown(value="Click 'Refresh Feed' to load stories.", label="Latest Stories")
            refresh_button = gr.Button("Refresh Feed 🔄", size="lg", variant="primary")
            refresh_button.click(fn=self.fetch_and_display_mood_feed, inputs=None, outputs=feed_output)


if __name__ == "__main__":
    app = HackerNewsFineTuner(AppConfig)
    demo = app.build_interface()
    print("Starting Gradio App...")
    demo.launch()

