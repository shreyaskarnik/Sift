---
title: Embedding Gemma Modkit
emoji: 😻
colorFrom: green
colorTo: indigo
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
pinned: false
---

# 🤖 Embedding Gemma Modkit: Fine-Tuning and Mood Reader

This project provides a set of tools to fine-tune a sentence-embedding model to understand your personal taste in Hacker News titles and then use that model to score and rank new articles based on their "vibe."

It includes three main applications:
1.  A **Gradio App** for interactive fine-tuning, evaluation, and real-time "vibe checks."
2.  An interactive **Command-Line (CLI) App** for viewing and scrolling through the scored feed directly in your terminal.
3.  A **Flask App** for a simple, deployable web "mood reader" that displays the live HN feed.

---

## ✨ Features

* **Interactive Fine-Tuning:** Use a Gradio interface to select your favorite Hacker News titles and fine-tune the `google/embeddinggemma-300m` model on your preferences.
* **Semantic Search Evaluation:** See the immediate impact of your training by comparing semantic search results before and after fine-tuning.
* **Live "Vibe Check":** Input any news title or text to get a real-time similarity score (its "vibe") against your personalized anchor.
* **Interactive CLI:** A terminal-based mood reader with color-coded output, scrolling, and live refresh capabilities.
* **Hacker News Mood Reader:** View the live Hacker News feed with each story scored and color-coded based on the current model's understanding of your taste.
* **Data & Model Management:** Easily import additional training data, export the generated dataset, and download the fine-tuned model as a ZIP file.
* **Standalone Flask App:** A lightweight, read-only web app to continuously display the scored HN feed, perfect for simple deployment.

---

## 🔧 How It Works

The core idea is to measure the "vibe" of a news title by calculating the semantic similarity between its embedding and the embedding of a fixed anchor phrase, defined in `config.py` as **`MY_FAVORITE_NEWS`**.

1.  **Embedding:** The `sentence-transformers` library is used to convert news titles and the anchor phrase into high-dimensional vectors (embeddings).
2.  **Scoring:** The cosine similarity (or dot product on normalized embeddings) between a title's embedding and the anchor's embedding is calculated. A higher score means a better "vibe."
3.  **Fine-Tuning:** The Gradio app generates a contrastive learning dataset from your selections.
    * **Positive Pairs:** (`MY_FAVORITE_NEWS`, `[A title you selected]`)
    * **Negative Pairs:** (`MY_FAVORITE_NEWS`, `[A title you did not select]`)
4.  **Training:** The model is trained using `MultipleNegativesRankingLoss`, which fine-tunes it to pull the embeddings of your "favorite" titles closer to the anchor phrase and push the others away.

## 🚀 Getting Started

### 1. Prerequisites
* Python 3.12+
* Git

### 2. Installation

```bash
# Clone the repository
git clone https://huggingface.co/spaces/bebechien/news-vibe-checker
cd news-vibe-checker

# Create and activate a virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows, use `venv\Scripts\activate`

# Install the required packages
pip install -r requirements.txt
````

### 3\. (Optional) Hugging Face Authentication

If you plan to use gated models or push your fine-tuned model to the Hugging Face Hub, you need to authenticate.

```bash
# Set your Hugging Face token as an environment variable
export HF_TOKEN="your_hf_token_here"
```

-----

## 🖥️ Running the Applications

You can run any of the three applications depending on your needs.

### Option A: Interactive Fine-Tuning (Gradio App)

This is the main application for creating and evaluating a personalized model.

**▶️ To run:**

```bash
python app.py
```

Navigate to the local URL provided (e.g., `http://127.0.0.1:7860`).

### Option B: Interactive Terminal Viewer (CLI App)

This app runs directly in your terminal, allowing you to quickly see and scroll through the scored Hacker News feed.

**▶️ To run:**

```bash
python cli_mood_reader.py
```

**Interactive Controls:**

  * **[↑|↓]** arrow keys to scroll through the story list.
  * **[SPACE]** to refresh the feed with the latest stories.
  * **[q]** to quit the application.

You can also start it with options:

```bash
# Specify a different model from Hugging Face
python cli_mood_reader.py --model google/embeddinggemma-300m

# Show 10 stories per screen instead of the default 15
python cli_mood_reader.py --top 10
```

### Option C: Standalone Web Viewer (Flask App)

This app is a simple, read-only web page that fetches and displays the scored HN feed. It's ideal for deploying a finished model.

**▶️ To run:**

```bash
# (Optional) Specify a model from the Hugging Face Hub
export MOOD_MODEL="bebechien/embedding-gemma-finetuned-hn"

# Run the Flask server
python flask_app.py
```

Navigate to `http://127.0.0.1:5000` to see the results.

-----

## ⚙️ Configuration

Key parameters can be adjusted in `config.py`:

  * `MODEL_NAME`: The base model to use for fine-tuning (e.g., `'google/embeddinggemma-300m'`).
  * `QUERY_ANCHOR`: The anchor text used for similarity scoring (e.g., `"MY_FAVORITE_NEWS"`).
  * `DEFAULT_MOOD_READER_MODEL`: The default model used by the Flask and CLI apps.
  * `HN_RSS_URL`: The RSS feed URL.
  * `CACHE_DURATION_SECONDS`: How long to cache the RSS feed data.

-----

## 📂 File Structure

```
.
├── app.py                  # Main Gradio application for fine-tuning
├── cli_mood_reader.py      # Interactive command-line mood reader
├── flask_app.py            # Standalone Flask application for mood reading
├── hn_mood_reader.py       # Core logic for fetching and scoring (used by Flask/CLI)
├── model_trainer.py        # Handles model loading and fine-tuning
├── vibe_logic.py           # Calculates similarity scores and "vibe" status
├── data_fetcher.py         # Fetches and caches the Hacker News RSS feed
├── config.py               # Central configuration for all modules
├── requirements.txt        # Python package dependencies
├── README.md               # This file
└── templates/              # HTML templates for the Flask app
    ├── index.html
    └── error.html
```

