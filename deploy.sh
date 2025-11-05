#!/bin/bash

echo "🚀 Deploying YunExpress Integration to Production..."

# Stop và xóa containers cũ
echo "📦 Stopping old containers..."
docker-compose down

# Build images mới
echo "🏗️  Building new images..."
docker-compose build --no-cache

# Start services
echo "▶️  Starting services..."
docker-compose up -d

# Chờ MySQL khởi động
echo "⏳ Waiting for MySQL to be ready..."
sleep 10

# Run migrations
echo "🔄 Running database migrations..."
docker-compose exec -T app npm run migrate

# Show logs
echo "📋 Showing logs..."
docker-compose logs -f --tail=50