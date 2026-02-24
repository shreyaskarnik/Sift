# Privacy Policy — Sift

**Last updated:** February 24, 2026

## Overview

Sift is a Chrome extension that scores web content using an embedding model running entirely in your browser. It is designed to be privacy-first: no data is collected, transmitted, or stored on any external server.

## Data Collection

Sift does **not** collect, transmit, or share any personal data. Specifically:

- **No analytics or telemetry** — Sift does not phone home or send usage data anywhere.
- **No user accounts** — Sift does not require sign-up or authentication.
- **No external API calls for scoring** — All model inference runs locally in your browser via WebAssembly or WebGPU.

## Data Stored Locally

Sift stores the following data in your browser's `chrome.storage.local` (never transmitted externally):

- **Settings** — Active categories, site toggles, sensitivity preferences, theme.
- **Training labels** — Thumbs up/down labels you create while browsing, used for CSV export and taste profile computation.
- **Cached model data** — Embedding model weights downloaded from HuggingFace Hub on first load, cached locally by the browser.

All locally stored data can be cleared by removing the extension.

## Network Requests

Sift makes network requests only to:

- **HuggingFace Hub** (`huggingface.co`) — To download the embedding model on first load. No user data is sent in these requests.
- **Google Fonts** (`fonts.googleapis.com`) — For UI typography in extension pages.

If you configure a custom model URL, Sift will fetch model files from that URL instead.

## Third-Party Services

Sift does not integrate with any third-party analytics, advertising, or tracking services.

## Changes

If this policy changes, the update will be reflected in this file in the project repository.

## Contact

For questions about this privacy policy, open an issue at https://github.com/shreyaskarnik/Sift/issues.
