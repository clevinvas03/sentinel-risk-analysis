"""DatacenterDynamics — industry news RSS.

Directly on-topic data centre coverage: grid/power, cooling, water, outages,
construction, sustainability. https://www.datacenterdynamics.com/en/rss/
"""

from __future__ import annotations

import feedparser

from .common import client, parse_struct_time, strip_html

FEED_URL = "https://www.datacenterdynamics.com/en/rss/"


def _full_text(url: str | None, fallback: str) -> str:
    """Best-effort fetch of the article body; fall back to the RSS summary."""
    if not url:
        return fallback
    try:
        with client() as c:
            resp = c.get(url)
            resp.raise_for_status()
            text = strip_html(resp.text)
            # crude: keep the densest middle section, avoid nav/footer noise
            return text if len(text) > len(fallback) else fallback
    except Exception:
        return fallback


def fetch(limit: int = 25, fetch_bodies: bool = False) -> list[dict]:
    feed = feedparser.parse(FEED_URL)
    docs: list[dict] = []
    for entry in feed.entries[:limit]:
        title = entry.get("title", "").strip()
        summary = strip_html(entry.get("summary", ""))
        body = _full_text(entry.get("link"), summary) if fetch_bodies else summary
        text = f"{title}\n\n{body}".strip()
        if not text:
            continue
        docs.append(
            {
                "source": "datacenterdynamics",
                "url": entry.get("link"),
                "title": title or "DatacenterDynamics article",
                "country": None,
                "published_at": parse_struct_time(entry.get("published_parsed")),
                "text": text,
            }
        )
    return docs
