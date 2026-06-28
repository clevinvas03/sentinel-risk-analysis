"""Planning Portal (UK) — planning & permitting news RSS.

Planning/permitting is a core data centre site-risk dimension. The Planning Portal
publishes a public news feed. If the feed is unreachable this source simply yields
nothing (the scraper tolerates per-source failures).
https://www.planningportal.co.uk/
"""

from __future__ import annotations

import feedparser

from .common import parse_struct_time, strip_html

# Public news feed; swap for any planning/permitting feed relevant to your region.
FEED_URL = "https://www.planningportal.co.uk/feeds/news"


def fetch(limit: int = 20) -> list[dict]:
    feed = feedparser.parse(FEED_URL)
    docs: list[dict] = []
    for entry in feed.entries[:limit]:
        title = entry.get("title", "").strip()
        summary = strip_html(entry.get("summary", ""))
        text = f"{title}\n\n{summary}".strip()
        if not text:
            continue
        docs.append(
            {
                "source": "planning",
                "url": entry.get("link"),
                "title": title or "Planning Portal news",
                "country": "United Kingdom",
                "published_at": parse_struct_time(entry.get("published_parsed")),
                "text": text,
            }
        )
    return docs
