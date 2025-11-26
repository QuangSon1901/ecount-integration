# syntax=docker/dockerfile:1.4
FROM node:18-bullseye-slim AS app

# Thiết lập locale & timezone
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

WORKDIR /app

# Thêm user không root TRƯỚC KHI cài dependencies
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /home/appuser /app

# Copy package.json
COPY --chown=appuser:appuser package*.json ./

# Switch sang appuser TRƯỚC KHI cài Playwright
USER appuser

# Set Playwright cache cho appuser
ENV PLAYWRIGHT_BROWSERS_PATH=/home/appuser/.cache/ms-playwright

# Cài dependencies và Playwright browsers
RUN --mount=type=cache,target=/home/appuser/.npm \
    npm ci --only=production && \
    npx playwright install chromium && \
    npx playwright install-deps chromium && \
    npm cache clean --force

# Copy code còn lại
COPY --chown=appuser:appuser . .

# Tạo thư mục logs/screenshots
RUN mkdir -p logs/screenshots

EXPOSE 3000
CMD ["node", "server.js"]