"""ReliefWeb — UN OCHA humanitarian reports API (public, no key).

Disaster / infrastructure reports useful for grid, flood, and geopolitical risk
context. https://apidoc.reliefweb.int/
"""

from __future__ import annotations

from datetime import datetime, timezone

from .common import client, strip_html

API_URL = "https://api.reliefweb.int/v1/reports"


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def fetch(limit: int = 30) -> list[dict]:
    params = {
        "appname": "dc-risk-intel",
        "profile": "full",
        "preset": "latest",
        "limit": str(limit),
        # focus on reports that touch infrastructure / energy / disaster themes
        "query[value]": "power OR grid OR flood OR earthquake OR infrastructure",
        "query[operator]": "OR",
    }
    docs: list[dict] = []
    with client() as c:
        resp = c.get(API_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    for item in data.get("data", []):
        f = item.get("fields", {})
        title = (f.get("title") or "").strip()
        body = strip_html(f.get("body-html") or f.get("body") or "")
        if not title and not body:
            continue
        countries = f.get("country") or []
        country = countries[0].get("name") if countries else None
        published = (f.get("date") or {}).get("created")
        docs.append(
            {
                "source": "reliefweb",
                "url": f.get("url") or f.get("url_alias"),
                "title": title or "ReliefWeb report",
                "country": country,
                "published_at": _parse_date(published),
                "text": f"{title}\n\n{body}".strip(),
            }
        )
    return docs
