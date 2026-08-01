# Rodoletas API (ufersin/backend) — deploy no projeto Railway `resolutoo`.
# (cache-bust: 2026-08-01T20:00Z — force rebuild after failed GitHub/RAILPACK deploys)
FROM rust:1.88-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libssl3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ufersin_backend /usr/local/bin/ufersin_backend
ENV PORT=8080
EXPOSE 8080
CMD ["ufersin_backend"]
