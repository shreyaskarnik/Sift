import os
import sys
import shutil
import click
from datetime import datetime
from typing import List

# --- Core Logic Imports ---
# These modules contain the application's functionality.
from config import AppConfig
from hn_mood_reader import HnMoodReader, FeedEntry
from vibe_logic import VIBE_THRESHOLDS

# --- Helper Functions ---

def get_status_text_and_color(score: float) -> (str, str):
    """
    Determines the plain text status and a corresponding color for a given score.
    """
    clamped_score = max(0.0, min(1.0, score))
    
    # Define colors for different vibe levels
    color_map = {
        "VIBE:HIGH": "green",
        "VIBE:GOOD": "cyan",
        "VIBE:FLAT": "yellow",
        "VIBE:LOW": "red"
    }
    
    for threshold in VIBE_THRESHOLDS:
        if clamped_score >= threshold.score:
            status = threshold.status.split(" ")[-1].replace('&nbsp;', '')
            return status, color_map.get(status, "white")
            
    # Fallback for the lowest score
    status = VIBE_THRESHOLDS[-1].status.split(" ")[-1].replace('&nbsp;', '')
    return status, color_map.get(status, "white")

def initialize_reader(model_name: str) -> HnMoodReader:
    """
    Initializes the HnMoodReader instance with the specified model.
    Exits the script if the model fails to load.
    """
    click.echo(f"Initializing mood reader with model: '{model_name}'...", err=True)
    try:
        reader = HnMoodReader(model_name=model_name)
        click.secho("✅ Model loaded successfully.", fg="green", err=True)
        return reader
    except Exception as e:
        click.secho(f"❌ FATAL: Could not initialize model '{model_name}'.", fg="red", err=True)
        click.secho(f"   Error: {e}", fg="red", err=True)
        sys.exit(1) # Exit with a non-zero code to indicate failure

def display_feed(scored_entries: List[FeedEntry], top: int, offset: int, model_name: str):
    """Clears the screen and displays the current slice of the feed."""
    click.clear()

    # Get terminal width, but default to 80 if it's too narrow
    # to avoid breaking the layout.
    try:
        terminal_width = shutil.get_terminal_size()[0]
    except OSError: # Handle cases where terminal size can't be determined (e.g., in a pipe)
        terminal_width = 80

    click.echo(f"📰 Hacker News Mood Reader")
    click.echo(f"   Model: {model_name}")
    click.echo(f"   Showing {offset + 1}-{min(offset + top, len(scored_entries))} of {len(scored_entries)} stories")
    click.secho("=" * terminal_width, fg="blue")

    header = f"{'VIBE':<5} | {'SCORE':<7} | {'PUBLISHED':<16} | {'TITLE'}"
    click.secho(header, bold=True)
    click.secho("-" * terminal_width, fg="blue")

    # Calculate the fixed width of the columns before the title
    # Vibe: 5
    # Score: | + ' ' + '0.0000' + ' ' = 9
    # Published: | + ' ' + 'YYYY-MM-DD HH:MM' + ' ' + | + ' ' = 21
    # Total fixed width = 5 + 9 + 21 = 35
    fixed_width = 35
    max_title_width = terminal_width - fixed_width
    # --- MODIFICATION END ---

    if not scored_entries:
        click.echo("No entries found in the feed.")
    else:
        # Display the current "page" of entries based on the offset
        for entry in scored_entries[offset:offset + top]:
            status, color = get_status_text_and_color(entry.mood.raw_score)

            # --- MODIFICATION: VIBE width changed from 12 to 5 ---
            # Also ensure the status text itself is truncated if it's longer than 5
            truncated_status = status[5:]
            vibe_part = click.style(f"{truncated_status:<5}", fg=color)

            score_part = f"| {entry.mood.raw_score:>.4f} "
            published_part = f"| {entry.published_time_str:<16} | "

            # --- Title Truncation Logic ---
            full_title = entry.title

            if len(full_title) > max_title_width:
                # Truncate and add ellipsis, reserving 3 chars for '...'
                title_part = full_title[:max_title_width - 3] + "..."
            else:
                title_part = full_title
            # --- End Title Truncation ---

            # Combine parts and print
            full_line = vibe_part + score_part + published_part + title_part
            click.echo(full_line)

    click.secho("-" * terminal_width, fg="blue")


# --- Main Application Logic (CLI Command) ---

@click.command()
@click.option(
    "-m", "--model",
    help="Name of the Sentence Transformer model from Hugging Face. Overrides MOOD_MODEL env var.",
    default=None,
    show_default=False
)
@click.option(
    "-n", "--top",
    help="Number of stories to display on screen at once.",
    default=15,
    type=int,
    show_default=True
)
def main(model, top):
    """
    Fetch and display Hacker News stories scored by a sentence-embedding model.
    Runs continuously. Use arrow keys to scroll, [SPACE] to refresh, [q] to quit.
    """
    # --- State Management ---
    model_name = model or os.environ.get("MOOD_MODEL") or AppConfig.DEFAULT_MOOD_READER_MODEL
    reader = initialize_reader(model_name)
    scored_entries: List[FeedEntry] = []
    scroll_offset = 0

    # --- Initial Fetch ---
    click.echo("Fetching initial feed...", err=True)
    try:
        scored_entries = reader.fetch_and_score_feed()
    except Exception as e:
        click.secho(f"❌ ERROR: Initial fetch failed: {e}", fg="red", err=True)

    # --- Main Loop ---
    while True:
        display_feed(scored_entries, top, scroll_offset, reader.model_name)
        
        click.secho("Use [↑|↓] to scroll, [SPACE] to refresh, or [q] to quit.", bold=True, err=True)
        key = click.getchar()

        if key == ' ':
            click.echo("Refreshing feed...", err=True)
            try:
                scored_entries = reader.fetch_and_score_feed()
                scroll_offset = 0  # Reset scroll on refresh
            except Exception as e:
                click.secho(f"❌ ERROR: Refresh failed: {e}", fg="red", err=True)
            continue
        
        elif key in ('q', 'Q'):
            click.echo("Exiting.")
            break
            
        # Arrow key handling for scrolling (might produce escape sequences)
        elif key == '\x1b[A':  # Up Arrow
            scroll_offset = max(0, scroll_offset - 1)
        elif key == '\x1b[B':  # Down Arrow
            # Prevent scrolling past the last page
            scroll_offset = min(scroll_offset + 1, max(0, len(scored_entries) - top))

if __name__ == "__main__":
    main()


