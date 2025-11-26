# syntax=docker/dockerfile:1.4
FROM node:18-bullseye-slim AS app

ENV TZ=Asia/Ho_Chi_Minh
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN echo "deb http://archive.debian.org/debian bullseye main contrib non-free" > /etc/apt/sources.list && \
    echo "deb http://archive.debian.org/debian bullseye-updates main contrib non-free" >> /etc/apt/sources.list && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install -y --no-install-recommends \
        wget ca-certificates gnupg curl xdg-utils \
        fonts-liberation fonts-wqy-zenhei fonts-wqy-microhei \
        libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
        libgbm1 libglib2.0-0 libgtk-3-0 libnss3 libx11-6 libx11-xcb1 libxcomposite1 \
        libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 libxss1 libxtst6 \
        libasound2 lsb-release && \
    rm -rf /var/lib/apt/lists/*

# Cài Chrome cho Puppeteer
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google.list && \
    apt-get update && apt-get install -y google-chrome-stable --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Cấu hình Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài dependencies và Playwright browsers (không dùng cache mount)
RUN npm ci --only=production && \
    npx playwright install chromium && \
    npx playwright install-deps chromium && \
    npm cache clean --force

# Copy source
COPY . .

RUN mkdir -p logs/screenshots

# Create user VÀ COPY Playwright browsers
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads /home/appuser/.cache \
    && cp -r /root/.cache/ms-playwright /home/appuser/.cache/ \
    && chown -R appuser:appuser /home/appuser /app

# Set Playwright path cho appuser
ENV PLAYWRIGHT_BROWSERS_PATH=/home/appuser/.cache/ms-playwright

USER appuser

EXPOSE 3000
CMD ["node", "server.js"]