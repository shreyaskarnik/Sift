import gradio as gr
from typing import Optional
from datetime import datetime

from .config import AppConfig
from .session_manager import HackerNewsFineTuner

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
