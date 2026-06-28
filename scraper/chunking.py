"""Naive but effective text chunking for RAG ingest.

Splits on paragraph boundaries and packs paragraphs into ~chunk-sized windows
(measured in words as a cheap token proxy) with a small overlap so context is not
lost at boundaries.
"""

from __future__ import annotations

import re


def _normalise(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str, target_words: int = 350, overlap_words: int = 60) -> list[str]:
    text = _normalise(text)
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_words = 0

    for para in paragraphs:
        words = para.split()
        if current_words + len(words) > target_words and current:
            chunks.append(" ".join(current))
            # carry an overlap tail into the next chunk
            tail = " ".join(current).split()[-overlap_words:]
            current = tail.copy()
            current_words = len(tail)
        current.extend(words)
        current_words += len(words)

    if current:
        chunks.append(" ".join(current))

    # Guard against a single gigantic paragraph exceeding the window: hard-split.
    out: list[str] = []
    for c in chunks:
        words = c.split()
        if len(words) <= target_words * 1.5:
            out.append(c)
            continue
        for i in range(0, len(words), target_words):
            out.append(" ".join(words[i : i + target_words]))
    return [c for c in out if c.strip()]


def word_count(text: str) -> int:
    return len(text.split())
