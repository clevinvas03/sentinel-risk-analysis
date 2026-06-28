"""Shared embedding model.

The SAME model is used in two places:
  - the scraper, to embed chunks at ingest time (in-process), and
  - the FastAPI /embed endpoint, which the TypeScript agent calls to embed the
    live query at question time.

Using one model name on both sides guarantees the stored chunk vectors and the
query vector share the same 384-dim space, so cosine similarity is meaningful.
"""

from __future__ import annotations

from functools import lru_cache

# all-MiniLM-L6-v2 -> 384-dimensional embeddings. Matches vector(384) in schema.sql.
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBED_DIM = 384


@lru_cache(maxsize=1)
def _model():
    # Imported lazily so importing this module is cheap (the model load is ~80MB).
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_NAME)


def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts -> list of 384-float vectors (normalized)."""
    if not texts:
        return []
    vectors = _model().encode(
        texts,
        normalize_embeddings=True,  # cosine distance is well-behaved on unit vectors
        convert_to_numpy=True,
    )
    return [v.tolist() for v in vectors]


def embed_one(text: str) -> list[float]:
    return embed([text])[0]
