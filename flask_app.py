# app.py

import os
from datetime import datetime
from typing import Optional

from flask import Flask, render_template

# Your existing config and core logic
from config import AppConfig
from hn_mood_reader import HnMoodReader, FeedEntry

# --- Flask App Initialization ---
app = Flask(__name__)

# --- Global Cache for the Model ---
global_reader: Optional[HnMoodReader] = None

def initialize_reader() -> HnMoodReader:
    """
    Initializes the HnMoodReader instance. This function is called once
    when the application starts.
    """
    print("Attempting to initialize the mood reader model...")
    model_name = os.environ.get("MOOD_MODEL", AppConfig.DEFAULT_MOOD_READER_MODEL)
    try:
        reader = HnMoodReader(model_name=model_name)
        print("Model loaded successfully.")
        return reader
    except Exception as e:
        # If the model fails to load, print a fatal error and exit the app.
        print(f"FATAL: Could not initialize model '{model_name}'. Error: {e}", file=sys.stderr)
        sys.exit(1) # Exit with a non-zero code to indicate failure

# --- Initialize the reader as soon as the app starts ---
global_reader = initialize_reader()

# --- Flask Route ---
@app.route('/')
def index():
    """Main page route."""
    try:
        scored_entries = global_reader.fetch_and_score_feed()
        
        return render_template(
            'index.html',
            entries=scored_entries,
            model_name=global_reader.model_name,
            last_updated=datetime.now().strftime('%H:%M:%S')
        )
    except Exception as e:
        # Render a simple error page if something goes wrong
        return render_template('error.html', error=str(e)), 500

if __name__ == '__main__':
    # Using debug=False is recommended for a stable display
# use_reloader=False prevents the app from initializing the model twice in debug mode
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
