# Motor multi-tenant (ecommerce/backend) — mesmo projeto Railway `resolutoo`.
# (cache-bust: 2026-08-01 PDV Pix force regenerate + pending payment_status)
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
COPY --from=builder /app/target/release/sonset_backend /usr/local/bin/sonset_backend
ENV PORT=8080
ENV PDV_PIX_FIX=1
EXPOSE 8080
CMD ["sonset_backend"]# watchPatterns cleared 2026-08-01T17:25:24.0517586-03:00
