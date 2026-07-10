# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:22-slim AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:server

# ── Stage 2: Build Rust server ────────────────────────────────────────────────
FROM rust:1-bookworm AS server-builder
RUN apt-get update && \
    apt-get install -y --no-install-recommends cmake pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy the entire src-tauri directory and build.
# Docker layer caching ensures rebuilds are fast when only source changes.
COPY src-tauri/ ./src-tauri/
WORKDIR /app/src-tauri
RUN cargo build --release --no-default-features --features server --bin seaquel-server

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates libssl3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server-builder /app/src-tauri/target/release/seaquel-server ./seaquel-server
COPY --from=frontend-builder /app/build-server ./static

ENV SEAQUEL_BIND_ADDR=0.0.0.0:3000
ENV SEAQUEL_STATIC_DIR=/app/static
ENV SEAQUEL_DATA_DIR=/app/data
ENV SEAQUEL_ADMIN_PASSWORD=admin
ENV RUST_LOG=info

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["./seaquel-server"]
