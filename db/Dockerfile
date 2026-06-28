# Postgres with BOTH PostGIS (parcel geometry + spatial adjacency) and pgvector
# (the knowledge-base embeddings). No single official image ships both, so we add
# pgvector to the official PostGIS image via the PGDG apt package.
FROM postgis/postgis:16-3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
