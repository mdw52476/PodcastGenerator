# Shoebox Studio render worker (Railway).
# Node + Remotion's headless Chrome + ffmpeg (from ffmpeg-static) + Python for music and alignment.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
# Chrome Headless Shell runtime libraries (per Remotion's Linux docs) + Python.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates python3 python3-pip \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
      libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

# numpy/scipy from pip (not apt) so faster-whisper's numpy and scipy always match.
RUN pip3 install --no-cache-dir --break-system-packages numpy scipy faster-whisper

RUN npm install -g pnpm@9.15.9

WORKDIR /app
# Install dependencies first so code changes don't redo this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/edit-plan/package.json packages/edit-plan/
COPY packages/text-rules/package.json packages/text-rules/
COPY packages/engine/package.json packages/engine/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile

COPY . .
RUN cd packages/engine && npx remotion browser ensure

ENV PYTHON=python3 \
    WORK_DIR=/tmp/shoebox-jobs \
    RENDER_CONCURRENCY=6

CMD ["pnpm", "worker"]
