FROM rust:1-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Tauri v2 Linux system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libwebkit2gtk-4.1-dev \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Pre-install tauri-cli globally (pre-built binary, fast)
RUN bun install --global @tauri-apps/cli@^2
