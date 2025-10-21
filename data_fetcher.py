import feedparser
import pickle
import os
import time
from datetime import datetime
from typing import Tuple, Any, Optional

# Assuming AppConfig is passed in via dependency injection in the refactored main app.

def format_published_time(published_parsed: Optional[time.struct_time]) -> str:
    """Safely converts a feedparser time struct to a formatted string."""
    if published_parsed:
        try:
            dt_obj = datetime.fromtimestamp(time.mktime(published_parsed))
            return dt_obj.strftime('%Y-%m-%d %H:%M')
        except Exception:
            return 'N/A'
    return 'N/A'

def load_feed_from_cache(config: Any) -> Tuple[Optional[Any], str]:
    """Attempts to load a feed object from the cache file if it exists and is not expired."""
    if not os.path.exists(config.CACHE_FILE):
        return None, "Cache file not found."

    try:
        # Check cache age
        file_age_seconds = time.time() - os.path.getmtime(config.CACHE_FILE)

        if file_age_seconds > config.CACHE_DURATION_SECONDS:
            # The cache is too old
            return None, f"Cache expired ({file_age_seconds:.0f}s old, limit is {config.CACHE_DURATION_SECONDS}s)."

        with open(config.CACHE_FILE, 'rb') as f:
            feed = pickle.load(f)
            return feed, f"Loaded successfully from cache (Age: {file_age_seconds:.0f}s)."

    except Exception as e:
        # If loading fails, treat it as a miss and attempt to clean up
        print(f"Warning: Failed to load cache file. Deleting corrupted cache. Reason: {e}")
        try:
            os.remove(config.CACHE_FILE)
        except OSError:
            pass # Ignore if removal fails
        return None, "Cache file corrupted or invalid. Will re-fetch."

def save_feed_to_cache(config: Any, feed: Any) -> None:
    """Saves the fetched feed object to the cache file."""
    try:
        with open(config.CACHE_FILE, 'wb') as f:
            pickle.dump(feed, f)
        print(f"Successfully saved new feed data to cache: {config.CACHE_FILE}")
    except Exception as e:
        print(f"Error saving to cache: {e}")

def read_hacker_news_rss(config: Any) -> Tuple[Optional[Any], str]:
    """
    Reads and parses the Hacker News RSS feed, using a cache if available.
    Returns the feedparser object and a status message.
    """
    url = config.HN_RSS_URL
    print(f"Attempting to fetch and parse RSS feed from: {url}")
    print("-" * 50)

    # 1. Attempt to load from cache
    feed, cache_status = load_feed_from_cache(config)
    print(f"Cache Status: {cache_status}")

    # 2. If cache miss or stale, fetch from web
    if feed is None:
        print("Starting network fetch...")
        try:
            # Use feedparser to fetch and parse the feed
            feed = feedparser.parse(url)

            if feed.status >= 400:
                status_msg = f"Error fetching the feed. HTTP Status: {feed.status}"
                print(status_msg)
                return None, status_msg

            if feed.bozo:
                # Bozo is set if any error occurred, even non-critical ones.
                print(f"Warning: Failed to fully parse the feed. Reason: {feed.get('bozo_exception')}")

            # 3. If fetch successful, save new data to cache
            if feed.entries:
                save_feed_to_cache(config, feed)
                status_msg = f"Successfully fetched and cached {len(feed.entries)} entries."
            else:
                status_msg = "Fetch successful, but no entries found in the feed."
                print(status_msg)
                feed = None # Ensure feed is None if no entries

        except Exception as e:
            status_msg = f"An unexpected error occurred during network processing: {e}"
            print(status_msg)
            return None, status_msg
    
    else:
        status_msg = cache_status

    return feed, status_msg

# Example usage (not part of the refactored module's purpose but good for testing)
if __name__ == '__main__':
    from config import AppConfig
    feed, status = read_hacker_news_rss(AppConfig)
    if feed and feed.entries:
        print(f"\nFetched {len(feed.entries)} entries. Top 3 titles:")
        for entry in feed.entries[:3]:
            print(f"- {entry.title}")
    else:
        print(f"Could not fetch the feed. Status: {status}")
