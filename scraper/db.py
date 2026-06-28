"""Postgres connection helper for the scraper (psycopg2 + pgvector)."""

from __future__ import annotations

import os

import psycopg2
from dotenv import load_dotenv
from pgvector.psycopg2 import register_vector

# Load .env from the project root (one level up from scraper/).
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgres://postgres:postgres@localhost:5432/risk"
)


def connect():
    """Open a connection with the vector type registered."""
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn
