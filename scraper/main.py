"""FastAPI embedding service.

Owns the sentence-transformers model. The TypeScript agent's
`search_knowledge_base` tool calls POST /embed to embed the live query, then runs
the pgvector similarity search itself (Next.js owns all DB reads).

Run:
    uvicorn main:app --port 8000 --reload
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from embeddings import EMBED_DIM, MODEL_NAME, embed

app = FastAPI(title="DC Risk Intel — Embedding Service")


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    model: str
    dim: int
    embeddings: list[list[float]]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME, "dim": EMBED_DIM}


@app.post("/embed", response_model=EmbedResponse)
def embed_endpoint(req: EmbedRequest) -> EmbedResponse:
    vectors = embed(req.texts)
    return EmbedResponse(model=MODEL_NAME, dim=EMBED_DIM, embeddings=vectors)
