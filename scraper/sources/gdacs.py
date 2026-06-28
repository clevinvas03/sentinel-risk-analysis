"""GDACS — Global Disaster Alert and Coordination System (public RSS).

Hazard alerts (earthquakes, floods, cyclones, etc.) that are directly relevant to
data centre site risk. https://www.gdacs.org/xml/rss.xml
"""

from __future__ import annotations

import feedparser

from .common import parse_struct_time, strip_html

FEED_URL = "https://www.gdacs.org/xml/rss.xml"


def fetch(limit: int = 40) -> list[dict]:
    feed = feedparser.parse(FEED_URL)
    docs: list[dict] = []
    for entry in feed.entries[:limit]:
        title = entry.get("title", "").strip()
        summary = strip_html(entry.get("summary", ""))
        country = entry.get("gdacs_country") or entry.get("gdacs_countryname") or None
        text = f"{title}\n\n{summary}".strip()
        if not text:
            continue
        docs.append(
            {
                "source": "gdacs",
                "url": entry.get("link"),
                "title": title or "GDACS alert",
                "country": country,
                "published_at": parse_struct_time(entry.get("published_parsed")),
                "text": text,
            }
        )
    return docs
