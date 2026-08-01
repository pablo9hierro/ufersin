# Motor multi-tenant (ecommerce/backend) — mesmo projeto Railway `resolutoo`.
# (cache-bust: 2026-08-01 connection-events + onboarding-gate — força rebuild após deploy falho)
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
EXPOSE 8080
CMD ["sonset_backend"]
