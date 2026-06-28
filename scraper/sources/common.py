"""Shared helpers + the document shape every source returns.

A source's fetch() returns a list of dicts:
    {source, url, title, country, published_at (datetime|None), text}
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "dc-risk-intel/0.1 (educational risk-analysis demo)"
TIMEOUT = httpx.Timeout(20.0)


def client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)


def strip_html(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text(separator="\n").strip()


def parse_struct_time(st) -> datetime | None:
    if not st:
        return None
    try:
        return datetime(*st[:6], tzinfo=timezone.utc)
    except Exception:
        return None
