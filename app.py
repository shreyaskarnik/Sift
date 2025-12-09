import gradio as gr
import os
import shutil
import time
import csv
import uuid
from itertools import cycle
from typing import List, Iterable, Tuple, Optional, Callable
from datetime import datetime

# Import modules
from data_fetcher import read_hacker_news_rss, format_published_time
from model_trainer import (
    authenticate_hf,
    train_with_dataset,
    get_top_hits,
    load_embedding_model,
    upload_model_to_hub
)
from config import AppConfig
from vibe_logic import VibeChecker
from sentence_transformers import SentenceTransformer

# --- Main Application Class (Session Scoped) ---

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
        self.target_titles: List[str] = [] 
        self.number_list: List[int] = [] 
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

    def refresh_data_and_model(self) -> Tuple[gr.update, gr.update]:
        """
        Reloads model and fetches data.
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
            return (
                gr.update(choices=[], label="Model Load Failed"),
                gr.update(value=error_msg)
            )

        # 2. Fetch fresh news data
        news_feed, status_msg = read_hacker_news_rss(self.config)
        titles_out, target_titles_out = [], []
        status_value: str = f"Ready. Session ID: {self.session_id[:8]}... | Status: {status_msg}"

        if news_feed is not None and news_feed.entries:
            titles_out = [item.title for item in news_feed.entries[:self.config.TOP_TITLES_COUNT]]
            target_titles_out = [item.title for item in news_feed.entries[self.config.TOP_TITLES_COUNT:]]
        else:
            titles_out = ["Error fetching news.", "Check console."]
            gr.Warning(f"Data reload failed. {status_msg}")

        self.titles = titles_out
        self.target_titles = target_titles_out
        self.number_list = list(range(len(self.titles)))

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
    def _create_hn_dataset(self, selected_ids: List[int]) -> Tuple[List[List[str]], str, str]:
        total_ids, selected_ids = set(self.number_list), set(selected_ids)
        non_selected_ids = total_ids - selected_ids
        is_minority = len(selected_ids) < (len(total_ids) / 2)

        anchor_ids, pool_ids = (non_selected_ids, list(selected_ids)) if is_minority else (selected_ids, list(non_selected_ids))

        def get_titles(anchor_id, pool_id):
            return (self.titles[pool_id], self.titles[anchor_id]) if is_minority else (self.titles[anchor_id], self.titles[pool_id])

        if not pool_ids or not anchor_ids:
             return [], "", "" 

        fav_idx = pool_ids[0] if is_minority else list(anchor_ids)[0]
        non_fav_idx = list(anchor_ids)[0] if is_minority else pool_ids[0]

        hn_dataset = []
        pool_cycler = cycle(pool_ids)
        for anchor_id in sorted(list(anchor_ids)):
            fav, non_fav = get_titles(anchor_id, next(pool_cycler))
            hn_dataset.append([self.config.QUERY_ANCHOR, fav, non_fav])

        return hn_dataset, self.titles[fav_idx], self.titles[non_fav_idx]

    def training(self, selected_ids: List[int]) -> str:
        if self.model is None:
             raise gr.Error("Model not loaded.")
        if not selected_ids:
            raise gr.Error("Select at least one title.")
        if len(selected_ids) == len(self.number_list):
            raise gr.Error("Cannot select all titles.")

        hn_dataset, _, _ = self._create_hn_dataset(selected_ids)
        self.last_hn_dataset = hn_dataset
        final_dataset = self.last_hn_dataset + self.imported_dataset
        
        if not final_dataset:
            raise gr.Error("Dataset is empty.")

        def semantic_search_fn() -> str:
            return get_top_hits(model=self.model, target_titles=self.target_titles, task_name=self.config.TASK_NAME, query=self.config.QUERY_ANCHOR)

        result = "### Search (Before):\n" + f"{semantic_search_fn()}\n\n"
        print(f"[{self.session_id}] Starting Training...")
        
        train_with_dataset(
            model=self.model, 
            dataset=final_dataset, 
            output_dir=self.output_dir, 
            task_name=self.config.TASK_NAME, 
            search_fn=semantic_search_fn
        )
        
        self._update_vibe_checker()
        print(f"[{self.session_id}] Training Complete.")

        result += "### Search (After):\n" + f"{semantic_search_fn()}"
        return result

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

        md = (f"## Hacker News Top Stories\n"
              f"**Session:** {self.session_id[:6]}<br>"
              f"**Model:** `{self.config.MODEL_NAME}`{' - Fine-tuned' if self.last_hn_dataset else ''}<br>"
              f"**Updated:** {datetime.now().strftime('%H:%M:%S')}\n\n"
              "| Vibe | Score | Title | Comments | Published |\n|---|---|---|---|---|\n")
        
        for item in scored_entries:
            md += (f"| {item['mood'].status_html} "
                   f"| {item['mood'].raw_score:.4f} "
                   f"| [{item['title']}]({item['link']}) "
                   f"| [Comments]({item['comments']}) "
                   f"| {item['published']} |\n")
        return md


# --- Session Wrappers ---

def refresh_wrapper(app):
    """
    Initializes the session if it's not already created, then runs the refresh.
    Returns the app instance to update the State.
    """
    if app is None or callable(app) or isinstance(app, type):
        print("Initializing new HackerNewsFineTuner session...")
        app = HackerNewsFineTuner(AppConfig)
    
    # Run the refresh logic
    update1, update2 = app.refresh_data_and_model()
    
    # Return 3 items: The App Instance (for State), Choice Update, Text Update
    return app, update1, update2

def import_wrapper(app, file):
    return app.import_additional_dataset(file)

def export_wrapper(app):
    return app.export_dataset()

def download_model_wrapper(app):
    return app.download_model()

def push_to_hub_wrapper(app, repo_name, oauth_token: Optional[gr.OAuthToken]):
    """
    Wrapper for pushing the model to the Hugging Face Hub.
    Gradio automatically injects 'oauth_token' if the user is logged in via LoginButton.
    """
    if oauth_token is None:
        return "⚠️ You must be logged in to push to the Hub. Please sign in above."
    
    # Extract the token string from the OAuthToken object
    token_str = oauth_token.token
    return app.upload_model(repo_name, token_str)

def training_wrapper(app, selected_ids):
    return app.training(selected_ids)

def vibe_check_wrapper(app, text):
    return app.get_vibe_check(text)

def mood_feed_wrapper(app):
    return app.fetch_and_display_mood_feed()


# --- Interface Setup ---

def build_interface() -> gr.Blocks:
    with gr.Blocks(title="EmbeddingGemma Modkit") as demo:
        # Initialize state as None. It will be populated by refresh_wrapper on load.
        session_state = gr.State()

        with gr.Column():
            gr.Markdown("# 🤖 EmbeddingGemma Modkit: Fine-Tuning and Mood Reader")
            gr.Markdown("This project provides a set of tools to fine-tune [EmbeddingGemma](https://huggingface.co/google/embeddinggemma-300m) to understand your personal taste in Hacker News titles and then use it to score and rank new articles based on their \"vibe\". The core idea is to measure the \"vibe\" of a news title by calculating the semantic similarity between its embedding and the embedding of a fixed anchor phrase, **`MY_FAVORITE_NEWS`**.<br>See [README](https://huggingface.co/spaces/google/embeddinggemma-modkit/blob/main/README.md) for more details.")
            gr.LoginButton(value="(Optional) Sign in to Hugging Face, if you want to push fine-tuned model to your repo.")
        
        with gr.Tab("🚀 Fine-Tuning & Evaluation"):
            with gr.Column():
                gr.Markdown("## Fine-Tuning & Semantic Search\nSelect titles to fine-tune the model towards making them more similar to **`MY_FAVORITE_NEWS`**.")
                with gr.Row():
                    favorite_list = gr.CheckboxGroup(choices=[], type="index", label="Hacker News Top Stories", show_select_all=True)
                    output = gr.Textbox(lines=14, label="Training and Search Results", value="Loading data...")
                
                with gr.Row():
                    clear_reload_btn = gr.Button("Clear & Reload")
                    run_training_btn = gr.Button("🚀 Run Fine-Tuning", variant="primary")
                
                gr.Markdown("--- \n ## Dataset & Model Management")
                gr.Markdown("To train on your own data, upload a CSV file with the following columns (no header required, or header ignored if present):\n1. **Anchor**: A fixed anchor phrase, `MY_FAVORITE_NEWS`.\n2. **Positive**: A title or contents that you like.\n3. **Negative**: A title or contents that you don't like.\n\nExample CSV Row:\n```\nMY_FAVORITE_NEWS,What is machine learning?,How to write a compiler from scratch.\n```")
                import_file = gr.File(label="Upload Additional Dataset (.csv)", file_types=[".csv"], height=50)
                
                with gr.Row():
                    download_dataset_btn = gr.Button("💾 Export Dataset")
                    download_model_btn = gr.Button("⬇️ Download Fine-Tuned Model")
                
                download_status = gr.Markdown("Ready.")
                
                with gr.Row():
                    dataset_output = gr.File(label="Download Dataset CSV", height=50, visible=False, interactive=False)
                    model_output = gr.File(label="Download Model ZIP", height=50, visible=False, interactive=False)

                gr.Markdown("### ☁️ Publish to Hugging Face Hub")
                with gr.Row():
                    repo_name_input = gr.Textbox(label="Target Repository Name", placeholder="e.g., my-news-vibe-model")
                    push_to_hub_btn = gr.Button("Push to Hub", variant="secondary")
                
                push_status = gr.Markdown("")

                # --- Interactions ---
                
                # 1. Initial Load: Initialize State and Load Data
                demo.load(
                    fn=refresh_wrapper, 
                    inputs=[session_state], 
                    outputs=[session_state, favorite_list, output]
                )
                
                buttons_to_lock = [
                    clear_reload_btn,
                    run_training_btn,
                    download_dataset_btn,
                    download_model_btn,
                    push_to_hub_btn
                ]

                # 2. Buttons
                clear_reload_btn.click(
                    fn=lambda: [gr.update(interactive=False)]*len(buttons_to_lock),
                    outputs=buttons_to_lock
                ).then(
                    fn=refresh_wrapper, 
                    inputs=[session_state], 
                    outputs=[session_state, favorite_list, output]
                ).then(
                    fn=lambda: [gr.update(interactive=True)]*len(buttons_to_lock),
                    outputs=buttons_to_lock
                )
                
                run_training_btn.click(
                    fn=lambda: [gr.update(interactive=False)]*len(buttons_to_lock),
                    outputs=buttons_to_lock
                ).then(
                    fn=training_wrapper, 
                    inputs=[session_state, favorite_list], 
                    outputs=[output]
                ).then(
                    fn=lambda: [gr.update(interactive=True)]*len(buttons_to_lock),
                    outputs=buttons_to_lock
                )

                import_file.change(
                    fn=import_wrapper, 
                    inputs=[session_state, import_file], 
                    outputs=[download_status]
                )

                download_dataset_btn.click(
                    fn=export_wrapper,
                    inputs=[session_state],
                    outputs=[dataset_output]
                ).then(
                    lambda p: gr.update(visible=True) if p else gr.update(), inputs=[dataset_output], outputs=[dataset_output]
                )

                download_model_btn.click(
                    fn=lambda: [gr.update(interactive=False)]*len(buttons_to_lock),
                    outputs=buttons_to_lock
                ).then(
                    lambda: [gr.update(value=None, visible=False), "Zipping..."], None, [model_output, download_status], queue=False
                ).then(
                    fn=download_model_wrapper,
                    inputs=[session_state],
                    outputs=[model_output]
                ).then(
                    lambda p: [gr.update(visible=p is not None, value=p), "ZIP ready." if p else "Zipping failed."], [model_output], [model_output, download_status]
                ).then(
                    fn=lambda: [gr.update(interactive=True)]*len(buttons_to_lock),
                    outputs=buttons_to_lock
                )

                # Push to Hub Interaction
                push_to_hub_btn.click(
                    fn=push_to_hub_wrapper,
                    inputs=[session_state, repo_name_input],
                    outputs=[push_status]
                )

        with gr.Tab("📰 Hacker News Similarity Check"):
            with gr.Column():
                gr.Markdown(f"## Live Hacker News Feed Vibe")
                gr.Markdown(f"This feed uses the current model (base or fine-tuned) to score the vibe of live Hacker News stories against **`{AppConfig.QUERY_ANCHOR}`**.")
                feed_output = gr.Markdown(value="Click 'Refresh Feed' to load stories.", label="Latest Stories")
                refresh_button = gr.Button("Refresh Feed 🔄", size="lg", variant="primary")
                refresh_button.click(fn=mood_feed_wrapper, inputs=[session_state], outputs=feed_output)

        with gr.Tab("💡 Similarity Lamp"):
            with gr.Column():
                gr.Markdown(f"## News Similarity Check")
                gr.Markdown(f"Enter text to see its similarity to **`{AppConfig.QUERY_ANCHOR}`**.\n**Vibe Key:** Green = High, Red = Low")
                news_input = gr.Textbox(label="Enter News Title or Summary", lines=3)
                vibe_check_btn = gr.Button("Check Similarity", variant="primary")
                
                gr.Examples(
                    examples=[
                        "Global Markets Rally as Inflation Data Shows Unexpected Drop for Third Consecutive Month",
                        "Astronomers Detect Strong Oxygen Signature on Potentially Habitable Exoplanet",
                        "City Council Approves Controversial Plan to Ban Cars from Downtown District by 2027",
                        "Tech Giant Unveils Prototype for \"Invisible\" AR Glasses, Promising a Screen-Free Future",
                        "Local Library Receives Overdue Book Checked Out in 1948 With An Anonymous Apology Note"
                    ],
                    inputs=news_input,
                    label="Try these examples"
                )

                session_info_display = gr.Markdown()

                with gr.Row():
                    vibe_color_block = gr.HTML(value='<div style="background-color: gray; height: 100px;"></div>', label="Mood Lamp")
                    with gr.Column():
                        vibe_score = gr.Textbox(label="Score", value="N/A", interactive=False)
                        vibe_status = gr.Textbox(label="Status", value="...", interactive=False)
                
                vibe_check_btn.click(
                    fn=vibe_check_wrapper, 
                    inputs=[session_state, news_input], 
                    outputs=[vibe_score, vibe_status, vibe_color_block, session_info_display]
                )

    return demo

if __name__ == "__main__":
    app_demo = build_interface()
    print("Starting Multi-User Gradio App...")
    app_demo.queue()
    app_demo.launch()
