# syntax=docker/dockerfile:1.4
FROM node:18-bullseye-slim AS app

# Thiết lập locale & timezone
ENV TZ=Asia/Ho_Chi_Minh
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Cập nhật mirror và cài dependencies cần thiết
RUN sed -i 's|deb.debian.org|deb.debian.org|g' /etc/apt/sources.list && \
    sed -i 's|security.debian.org|deb.debian.org|g' /etc/apt/sources.list && \
    apt-get update && apt-get install -y \
        wget ca-certificates gnupg curl xdg-utils \
        fonts-liberation fonts-wqy-zenhei fonts-wqy-microhei \
        libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
        libgbm1 libglib2.0-0 libgtk-3-0 libnss3 libx11-6 libx11-xcb1 libxcomposite1 \
        libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 libxss1 libxtst6 \
        libasound2 lsb-release --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Cài Chrome sớm để được cache
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google.list && \
    apt-get update && apt-get install -y google-chrome-stable --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Cấu hình Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Cấu hình Playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Copy package.json riêng để cache npm install
COPY package*.json ./

# ⚡ Dùng BuildKit cache để tăng tốc npm ci
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && npm cache clean --force

# Copy code còn lại
COPY . .

# Tạo thư mục logs/screenshots
RUN mkdir -p logs/screenshots

# Thêm user không root và set permissions
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser /app /ms-playwright

USER pptruser

EXPOSE 3000
CMD ["node", "server.js"]