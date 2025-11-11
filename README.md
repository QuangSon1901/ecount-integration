# SSH vào server
ssh root@your_server_ip

# Update system
sudo dnf update -y

# Install Docker
sudo dnf config-manager --add-repo=https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Install Docker Compose
sudo curl -SL https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

# Verify installation
docker --version
docker-compose --version

# Install Git
sudo dnf install -y git

# Setup + Dump DB Backup

# Configure firewall

# Clone Project Git
https://github.com/QuangSon1901/ecount-integration.git

# Copy và chỉnh sửa .env
cp .env.production .env
nano .env
chmod 600 .env

# Build Docker
DOCKER_BUILDKIT=1 docker-compose build
docker-compose up -d
- Lưu ý:
+ setup DB trước
+ cấp quyền ghi cho thư mục logs
+ expose port đúng với Dockerfile


# Install Nginx
sudo dnf install -y nginx

# Configure Nginx
sudo nano /etc/nginx/conf.d/yunexpress.conf

# Test Nginx config
sudo nginx -t

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Restart Nginx
sudo systemctl restart nginx
