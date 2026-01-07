#!/bin/bash

# NooTasks AWS Deployment Script
# Run this script on your EC2 instance after SSH connection

set -e

echo "🚀 Starting NooTasks deployment..."

# Update system
echo "📦 Updating system packages..."
sudo yum update -y

# Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Clone repository
echo "📥 Cloning NooTasks repository..."
if [ -d "NooTasks" ]; then
    echo "Directory exists, pulling latest changes..."
    cd NooTasks
    git pull
else
    git clone https://github.com/kgnvsk/NooTasks.git
    cd NooTasks
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build project
echo "🔨 Building project..."
npm run build

# Create .env if not exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found!"
    echo "Please create .env file with your credentials"
    echo "Example:"
    cat .env.example
    exit 1
fi

# Start with PM2
echo "🚀 Starting bot with PM2..."
pm2 stop nootasks 2>/dev/null || true
pm2 start dist/index.js --name nootasks

# Save PM2 config
pm2 save

# Setup PM2 startup
echo "⚙️  Setting up PM2 autostart..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

echo "✅ Deployment complete!"
echo ""
echo "📊 Check status: pm2 status"
echo "📝 View logs: pm2 logs nootasks"
echo "🔄 Restart: pm2 restart nootasks"
echo "⏹️  Stop: pm2 stop nootasks"
