import gradio as gr
from typing import Optional, Dict, List
from datetime import datetime

from .config import AppConfig
from .session_manager import HackerNewsFineTuner

# --- Constants for Labels ---
LABEL_FAV = "👍"
LABEL_NEU = "😐"
LABEL_DIS = "👎"

# --- Session Wrappers ---

def refresh_wrapper(app):
    if app is None or callable(app) or isinstance(app, type):
        print("Initializing new HackerNewsFineTuner session...")
        app = HackerNewsFineTuner(AppConfig)
    
    # Run the refresh logic
    # choices_list is a simple list of strings: ["Title 1", "Title 2", ...]
    choices_list, log_update = app.refresh_data_and_model()
    
    # Reset user labels
    empty_labels = {}
    
    return app, choices_list, empty_labels, log_update

def update_hub_interactive(app, username: Optional[str] = None):
    is_logged_in = username is not None
    has_model_tuned = app is not None and bool(app.last_hn_dataset)
    
    return gr.update(interactive=is_logged_in), gr.update(interactive=is_logged_in and has_model_tuned)

def on_app_load(app, profile: Optional[gr.OAuthProfile] = None):
    # 1. Initialize/Refresh Session
    app, stories, labels, text_update = refresh_wrapper(app)
    
    # 2. Extract Username safely
    username = profile.username if profile else None
    
    # 3. Get UI Updates using the helper
    repo_update, push_update = update_hub_interactive(app, username)

    # Return 7 items: App state, Data updates (3), Hub updates (2), Username state (1)
    return app, stories, labels, text_update, repo_update, push_update, username

def update_repo_preview(username, repo_name):
    """Updates the markdown preview to show 'username/repo_name'."""
    if not username:
        return "⚠️ Sign in to see the target repository path."
    
    clean_repo = repo_name.strip() if repo_name else "..."
    return f"Target Repository: **`{username}/{clean_repo}`**"

def import_wrapper(app, file):
    return app.import_additional_dataset(file)

def export_wrapper(app):
    return app.export_dataset()

def download_model_wrapper(app):
    return app.download_model()

def push_to_hub_wrapper(app, repo_name, oauth_token: Optional[gr.OAuthToken]):
    if oauth_token is None:
        return "⚠️ You must be logged in to push to the Hub. Please sign in above."
    token_str = oauth_token.token
    return app.upload_model(repo_name, token_str)

def training_wrapper(app, stories: List[str], labels: Dict[int, str]):
    """
    Parses the Stories and Labels to extract Positive and Negative indices.
    stories: List of titles
    labels: Dictionary of {index: LABEL_FAV | LABEL_DIS | LABEL_NEU}
    """
    pos_ids = []
    neg_ids = []
    
    # Iterate through all available stories by index
    for i in range(len(stories)):
        # Get label for this index, default to Neutral if not set
        label = labels.get(i, LABEL_NEU)
        
        if label == LABEL_FAV:
            pos_ids.append(i)
        elif label == LABEL_DIS:
            neg_ids.append(i)
            
    return app.training(pos_ids, neg_ids)

def vibe_check_wrapper(app, text):
    return app.get_vibe_check(text)

def mood_feed_wrapper(app):
    return app.fetch_and_display_mood_feed()


# --- Interface Setup ---

def build_interface() -> gr.Blocks:
    with gr.Blocks(title="EmbeddingGemma Modkit") as demo:
        session_state = gr.State()
        username_state = gr.State()
        
        # State variables for the Feed List and User Choices
        stories_state = gr.State([]) 
        labels_state = gr.State({})
        reset_counter = gr.State(0)

        with gr.Column():
            gr.Markdown("# 🤖 EmbeddingGemma Modkit: Fine-Tuning and Mood Reader")
            gr.Markdown("This project provides a set of tools to fine-tune [EmbeddingGemma](https://huggingface.co/google/embeddinggemma-300m) to understand your personal taste in Hacker News titles and then use it to score and rank new articles based on their \"vibe\". The core idea is to measure the \"vibe\" of a news title by calculating the semantic similarity between its embedding and the embedding of a fixed anchor phrase, **`MY_FAVORITE_NEWS`**.<br>See [README](https://huggingface.co/spaces/google/embeddinggemma-modkit/blob/main/README.md) for more details.")
        
        with gr.Tab("⚙️ Train & Export"):
            
            # --- Model Indicator ---
            gr.Dropdown(
                choices=[f"{AppConfig.MODEL_NAME}"], 
                value=f"{AppConfig.MODEL_NAME}", 
                label="Base Model for Fine-tuning", 
                interactive=False
            )
        
            # --- Step 0: Login ---
            with gr.Accordion("0️⃣ Step 0: Sign In (Optional)", open=True):
                gr.Markdown("Sign in to Hugging Face if you plan to push your fine-tuned model to the Hub later (Step 3).")
                with gr.Row():
                    gr.LoginButton(value="Sign in with Hugging Face")
                    with gr.Column(scale=3):
                        gr.Markdown("")
            
            # --- Step 1: Data Selection ---
            with gr.Accordion("1️⃣ Step 1: Select Data Source", open=True):
                gr.Markdown("Select titles from the live Hacker News feed **OR** upload your own CSV dataset to prepare your training data.")
                
                with gr.Column():
                    # Option A: Live Feed (Radio List)
                    with gr.Accordion("Option A: Live Hacker News Feed", open=True):
                        gr.Markdown("Rate the stories below to define your vibe.\n\n**⚠️ Note: You must select at least one Favorite and one Dislike to run training.**")
                        
                        with gr.Row():
                            reset_all_btn = gr.Button("Reset Selection ↺", variant="secondary", scale=1)
                            with gr.Column(scale=3):
                                gr.Markdown("")
                        
                        # Dynamic rendering of the story list
                        @gr.render(inputs=[stories_state, reset_counter])
                        def render_story_list(stories, _counter):
                            if not stories:
                                gr.Markdown("*No stories loaded. Click 'Reset Model & Fine-tuning state' to fetch data.*")
                                return
                            
                            for i, title in enumerate(stories[:10]):
                                with gr.Row(variant="compact", elem_id=f"story_row_{i}"):
                                    # Title
                                    with gr.Column(scale=3):
                                    	gr.Markdown(f"{title}")
                                    
                                    # Radio Selection
                                    radio = gr.Radio(
                                        choices=[LABEL_FAV, LABEL_NEU, LABEL_DIS],
                                        value=LABEL_NEU,
                                        show_label=False,
                                        container=False,
                                        min_width=80,
                                        scale=1,
                                        interactive=True
                                    )
                                    
                                    # Update logic
                                    def update_label(new_val, current_labels, idx=i):
                                        current_labels[idx] = new_val
                                        return current_labels

                                    radio.change(
                                        fn=update_label,
                                        inputs=[radio, labels_state],
                                        outputs=[labels_state]
                                    )

                    # Option B: Upload
                    with gr.Accordion("Option B: Upload Custom Dataset", open=False):
                        gr.Markdown("Upload a CSV file with columns (no header required, or header ignored if present): `Anchor`, `Positive`, `Negative`.")
                        gr.Markdown("See also: [example_training.dataset.csv](https://huggingface.co/spaces/google/embeddinggemma-modkit/blob/main/example_training_dataset.csv)<br>Example:<br>`MY_FAVORITE_NEWS,Good Title,Bad Title`")
                        import_file = gr.File(label="Upload Additional Dataset (.csv)", file_types=[".csv"], height=100)

            # --- Step 2: Training ---
            with gr.Accordion("2️⃣ Step 2: Run Tuning", open=True):
                gr.Markdown("Fine-tune the model using the data selected or uploaded above.")
                
                with gr.Row():
                    run_training_btn = gr.Button("🚀 Run Fine-Tuning", variant="primary", scale=1)
                    clear_reload_btn = gr.Button("Reset Model & Fine-tuning state", scale=1)
                
                output = gr.Textbox(lines=10, label="Training Logs & Search Results", value="Waiting to start...", autoscroll=True)

            # --- Step 3: Push to Hub ---
            with gr.Accordion("3️⃣ Step 3: Save to Hugging Face Hub (Optional)", open=False):
                gr.Markdown("Push your fine-tuned model to your personal Hugging Face account.")
                
                with gr.Row():
                    repo_name_input = gr.Textbox(label="Target Repository Name", value="my-embeddinggemma-news-vibe", placeholder="e.g., my-embeddinggemma-news-vibe", interactive=False)
                    push_to_hub_btn = gr.Button("Save to Hugging Face Hub", variant="secondary", interactive=False)
                
                repo_id_preview = gr.Markdown("Target Repository: (Waiting for input...)")
                
                push_status = gr.Markdown("")

            # --- Step 4: Downloads ---
            with gr.Accordion("4️⃣ Step 4: Download Artifacts", open=False):
                gr.Markdown("Export your combined dataset or download the fine-tuned model locally.")

                with gr.Row():
                    download_dataset_btn = gr.Button("💾 Export Dataset", interactive=False)
                    download_model_btn = gr.Button("⬇️ Download Model ZIP", interactive=False)
                
                download_status = gr.Markdown("Ready.")
                
                with gr.Row():
                    dataset_output = gr.File(label="Download Dataset CSV", height=50, visible=False, interactive=False)
                    model_output = gr.File(label="Download Model ZIP", height=50, visible=False, interactive=False)

            # --- Interaction Logic ---
            
            action_buttons = [
                clear_reload_btn,
                run_training_btn,
                download_dataset_btn,
                download_model_btn
            ]
            
            def set_interactivity(interactive: bool):
                """Helper to lock/unlock all main action buttons."""
                return [gr.update(interactive=interactive) for _ in action_buttons]
            
            # 1. App Startup
            # ----------------
            demo.load(
                fn=lambda: set_interactivity(False), outputs=action_buttons
            ).then(
                fn=on_app_load, 
                inputs=[session_state], 
                outputs=[session_state, stories_state, labels_state, output, repo_name_input, push_to_hub_btn, username_state]
            ).then(
                fn=update_repo_preview,
                inputs=[username_state, repo_name_input],
                outputs=[repo_id_preview]
            ).then(
                fn=lambda: [gr.update(interactive=True)]*2, outputs=[clear_reload_btn, run_training_btn]
            )
            
            # 2. Reset / Refresh / Clear Selections
            # ----------------
            clear_reload_btn.click(
                fn=lambda: set_interactivity(False), outputs=action_buttons
            ).then(
                fn=lambda: gr.update(interactive=False), outputs=push_to_hub_btn
            ).then(
                fn=refresh_wrapper, 
                inputs=[session_state], 
                outputs=[session_state, stories_state, labels_state, output]
            ).then(
                fn=lambda: [gr.update(interactive=True)]*2, outputs=[clear_reload_btn, run_training_btn]
            ).then(
                fn=update_hub_interactive,
                inputs=[session_state, username_state],
                outputs=[repo_name_input, push_to_hub_btn]
            )
            
            # Reset Selection Button Logic
            def reset_all_selections(counter):
                # Returns: (incremented counter, empty dict for labels)
                return counter + 1, {}

            reset_all_btn.click(
                fn=reset_all_selections,
                inputs=[reset_counter],
                outputs=[reset_counter, labels_state]
            )
            
            # 3. Import Data
            # ----------------
            import_file.change(
                fn=import_wrapper, 
                inputs=[session_state, import_file], 
                outputs=[download_status]
            )
            
            # 4. Run Training
            # ----------------
            run_training_btn.click(
                fn=lambda: set_interactivity(False), outputs=action_buttons
            ).then(
                fn=training_wrapper, 
                inputs=[session_state, stories_state, labels_state], 
                outputs=[output]
            ).then(
                # Unlock all buttons (including downloads now that we have a model)
                fn=lambda: set_interactivity(True), outputs=action_buttons
            ).then(
                fn=update_hub_interactive,
                inputs=[session_state, username_state],
                outputs=[repo_name_input, push_to_hub_btn]
            )
            
            # 5. Downloads
            # ----------------
            download_dataset_btn.click(
                fn=export_wrapper,
                inputs=[session_state],
                outputs=[dataset_output]
            ).then(
                # Just show the file output if it exists
                lambda p: gr.update(visible=True) if p else gr.update(), 
                inputs=[dataset_output], 
                outputs=[dataset_output]
            )

            download_model_btn.click(
                # Lock UI
                fn=lambda: set_interactivity(False), outputs=action_buttons
            ).then(
                # Reset previous outputs and show "Zipping..."
                fn=lambda: [gr.update(value=None, visible=False), "⏳ Zipping model..."], 
                outputs=[model_output, download_status]
            ).then(
                # Generate Zip
                fn=download_model_wrapper,
                inputs=[session_state],
                outputs=[model_output]
            ).then(
                # Update UI with result
                fn=lambda p: [gr.update(visible=p is not None, value=p), "✅ ZIP ready." if p else "❌ Zipping failed."], 
                inputs=[model_output], 
                outputs=[model_output, download_status]
            ).then(
                # Unlock UI
                fn=lambda: set_interactivity(True), outputs=action_buttons
            )
            
            # 6. Push to Hub
            # ----------------
            repo_name_input.change(
                fn=update_repo_preview,
                inputs=[username_state, repo_name_input],
                outputs=[repo_id_preview]
            )

            push_to_hub_btn.click(
                fn=push_to_hub_wrapper,
                inputs=[session_state, repo_name_input],
                outputs=[push_status]
            )

        with gr.Tab("📰 Live Ranked Feed"):
            with gr.Column():
                gr.Markdown(f"## Live Hacker News Feed Vibe")
                gr.Markdown(f"This feed uses the current model (base or fine-tuned) to score the vibe of live Hacker News stories against **`{AppConfig.QUERY_ANCHOR}`**.")
                feed_output = gr.Markdown(value="Click 'Refresh Feed' to load stories.", label="Latest Stories")
                refresh_button = gr.Button("Refresh Feed 🔄", size="lg", variant="primary")
                refresh_button.click(fn=mood_feed_wrapper, inputs=[session_state], outputs=feed_output)

        with gr.Tab("🧪 Vibe Check Playground"):
            with gr.Column():
                gr.Markdown(f"## News Similarity Check")
                gr.Markdown(f"Enter text to see its similarity to **`{AppConfig.QUERY_ANCHOR}`**.<br>**Vibe Key:** <span style='color:green'>Green = High</span>, <span style='color:yellow'>Yellow = Neutral</span>, <span style='color:red'>Red = Low</span>")

                news_input = gr.Textbox(label="Enter News Title or Summary", lines=3, render=False)

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
                
                news_input.render()
                vibe_check_btn = gr.Button("Check Similarity", variant="primary")
                
                session_info_display = gr.Markdown()

                with gr.Column():
                    vibe_score = gr.Textbox(label="Score", value="N/A", interactive=False)
                    vibe_lamp = gr.Textbox(label="Mood Lamp", max_lines=1, elem_id="mood_lamp", interactive=False)
                    vibe_status = gr.Textbox(label="Status", value="...", interactive=False)
                    style_thml = gr.HTML(value="<style>#mood_lamp input {background-color: gray;}</style>")
                
                vibe_check_btn.click(
                    fn=vibe_check_wrapper, 
                    inputs=[session_state, news_input], 
                    outputs=[vibe_score, vibe_status, style_thml, session_info_display]
                )

    return demo
