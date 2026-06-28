"""Ingest pipeline: pull public sources -> upsert documents -> chunk -> embed -> store.

Usage:
    python scrape.py                # all sources
    python scrape.py gdacs dcd      # only the named sources

Each source is best-effort: a failure in one source is logged and skipped so a
single dead feed never aborts the whole run.
"""

from __future__ import annotations

import sys

from chunking import chunk_text, word_count
from db import connect
from embeddings import embed
from sources import dcd, gdacs, planning, reliefweb

SOURCES = {
    "gdacs": gdacs.fetch,
    "reliefweb": reliefweb.fetch,
    "datacenterdynamics": dcd.fetch,
    "dcd": dcd.fetch,  # alias
    "planning": planning.fetch,
}


def store_document(conn, doc: dict) -> int | None:
    """Upsert a document by URL; returns its id, or None if unchanged/skipped.

    Re-ingesting an existing URL refreshes its chunks (delete + re-insert) so the
    KB stays current without duplicating documents.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO documents (source, url, title, country, published_at, raw_text)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (url) DO UPDATE
              SET title = EXCLUDED.title,
                  country = COALESCE(EXCLUDED.country, documents.country),
                  published_at = COALESCE(EXCLUDED.published_at, documents.published_at),
                  raw_text = EXCLUDED.raw_text,
                  fetched_at = now()
            RETURNING id
            """,
            (
                doc["source"],
                doc.get("url"),
                doc["title"],
                doc.get("country"),
                doc.get("published_at"),
                doc["text"],
            ),
        )
        doc_id = cur.fetchone()[0]
        # refresh chunks for this document
        cur.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
    return doc_id


def store_chunks(conn, doc_id: int, text: str) -> int:
    chunks = chunk_text(text)
    if not chunks:
        return 0
    vectors = embed(chunks)
    with conn.cursor() as cur:
        for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
            cur.execute(
                """
                INSERT INTO chunks (document_id, chunk_index, text, token_count, embedding)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (doc_id, i, chunk, word_count(chunk), vec),
            )
    return len(chunks)


def ingest(names: list[str]) -> None:
    conn = connect()
    total_docs = total_chunks = 0
    try:
        for name in names:
            fetch = SOURCES.get(name)
            if not fetch:
                print(f"  ! unknown source: {name}")
                continue
            print(f"==> {name}: fetching…")
            try:
                docs = fetch()
            except Exception as e:  # noqa: BLE001 — tolerate dead feeds
                print(f"  ! {name} failed: {e}")
                continue
            print(f"    {len(docs)} documents")
            for doc in docs:
                if not doc.get("url"):
                    continue  # need a URL for de-dup upsert
                doc_id = store_document(conn, doc)
                n = store_chunks(conn, doc_id, doc["text"])
                conn.commit()
                total_docs += 1
                total_chunks += n
        print(f"\nDone. {total_docs} documents, {total_chunks} chunks ingested.")
    finally:
        conn.close()


if __name__ == "__main__":
    requested = sys.argv[1:]
    if not requested:
        requested = ["gdacs", "reliefweb", "datacenterdynamics", "planning"]
    ingest(requested)
