#!/bin/bash
# ============================================================================
# DigitalOcean Deployment Script
# ============================================================================
# Run this script on your DigitalOcean droplet after initial setup
#
# Usage:
#   chmod +x deploy-digitalocean.sh
#   ./deploy-digitalocean.sh

set -e  # Exit on any error

echo "🚀 Starting Mafia Game Deployment to DigitalOcean..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ============================================================================
# 1. CHECK PREREQUISITES
# ============================================================================
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 not found. Installing...${NC}"
    sudo apt update
    sudo apt install -y python3.11 python3.11-venv python3-pip
fi

if ! command -v mongod &> /dev/null; then
    echo -e "${RED}❌ MongoDB not found. Please install MongoDB first!${NC}"
    echo "Follow Step 3 in DIGITALOCEAN_MIGRATION_GUIDE.md"
    exit 1
fi

if ! command -v nginx &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Nginx...${NC}"
    sudo apt install -y nginx
fi

echo -e "${GREEN}✅ Prerequisites OK${NC}"

# ============================================================================
# 2. SET UP VIRTUAL ENVIRONMENT
# ============================================================================
echo -e "${YELLOW}🐍 Setting up Python virtual environment...${NC}"

if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
else
    echo -e "${GREEN}✅ Virtual environment already exists${NC}"
fi

source venv/bin/activate

# ============================================================================
# 3. INSTALL DEPENDENCIES
# ============================================================================
echo -e "${YELLOW}📦 Installing Python dependencies...${NC}"
pip install --upgrade pip
pip install -r requirements.txt
echo -e "${GREEN}✅ Dependencies installed${NC}"

# ============================================================================
# 4. CHECK .ENV FILE
# ============================================================================
echo -e "${YELLOW}⚙️  Checking .env configuration...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Copy .env.example to .env and fill in your values:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Check if MongoDB URL has authentication
if grep -q "mongodb://localhost:27017\"" .env 2>/dev/null; then
    echo -e "${RED}⚠️  WARNING: MongoDB has no authentication in .env!${NC}"
    echo "Update MONGO_URL in .env to include username and password"
    echo "Example: mongodb://user:password@localhost:27017/dbname?authSource=dbname"
fi

echo -e "${GREEN}✅ .env file exists${NC}"

# ============================================================================
# 5. CREATE SYSTEMD SERVICE
# ============================================================================
echo -e "${YELLOW}🔧 Setting up systemd service...${NC}"

CURRENT_USER=$(whoami)
BACKEND_PATH=$(pwd)

sudo tee /etc/systemd/system/mafia-backend.service > /dev/null <<EOF
[Unit]
Description=Mafia Game Backend API
After=network.target mongod.service
Requires=mongod.service

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$BACKEND_PATH
Environment="PATH=$BACKEND_PATH/venv/bin"
ExecStart=$BACKEND_PATH/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=10
StandardOutput=append:/home/$CURRENT_USER/mafia-backend.log
StandardError=append:/home/$CURRENT_USER/mafia-backend-error.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mafia-backend
echo -e "${GREEN}✅ Systemd service created${NC}"

# ============================================================================
# 6. START SERVICE
# ============================================================================
echo -e "${YELLOW}🚀 Starting backend service...${NC}"
sudo systemctl restart mafia-backend

sleep 3

if sudo systemctl is-active --quiet mafia-backend; then
    echo -e "${GREEN}✅ Backend service is running!${NC}"
else
    echo -e "${RED}❌ Backend service failed to start${NC}"
    echo "Check logs with: sudo journalctl -u mafia-backend -n 50"
    exit 1
fi

# ============================================================================
# 7. TEST BACKEND
# ============================================================================
echo -e "${YELLOW}🧪 Testing backend...${NC}"

if curl -s http://localhost:8000/ > /dev/null; then
    echo -e "${GREEN}✅ Backend responding on http://localhost:8000${NC}"
else
    echo -e "${RED}❌ Backend not responding${NC}"
    exit 1
fi

# ============================================================================
# 8. NGINX CONFIGURATION
# ============================================================================
echo -e "${YELLOW}🌐 Would you like to configure Nginx? (y/n)${NC}"
read -r configure_nginx

if [ "$configure_nginx" = "y" ]; then
    echo "Enter your domain (or droplet IP):"
    read -r server_name
    
    sudo tee /etc/nginx/sites-available/mafia-backend > /dev/null <<EOF
server {
    listen 80;
    server_name $server_name;
    
    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;
    
    client_max_body_size 10M;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
    
    sudo ln -sf /etc/nginx/sites-available/mafia-backend /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl restart nginx
    
    echo -e "${GREEN}✅ Nginx configured for $server_name${NC}"
    echo -e "${YELLOW}💡 To enable HTTPS, run: sudo certbot --nginx -d $server_name${NC}"
fi

# ============================================================================
# COMPLETION
# ============================================================================
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "📊 Service Status:"
sudo systemctl status mafia-backend --no-pager -l
echo ""
echo "🔗 Your API is running at:"
echo "   Local: http://localhost:8000"
if [ -n "$server_name" ]; then
    echo "   Public: http://$server_name"
fi
echo ""
echo "📝 Useful Commands:"
echo "   View logs:     sudo journalctl -u mafia-backend -f"
echo "   Restart:       sudo systemctl restart mafia-backend"
echo "   Check status:  sudo systemctl status mafia-backend"
echo "   Stop:          sudo systemctl stop mafia-backend"
echo ""
echo "🔐 Next Steps:"
echo "   1. Set up SSL: sudo certbot --nginx -d yourdomain.com"
echo "   2. Configure automated backups (see guide)"
echo "   3. Enable monitoring in DigitalOcean dashboard"
echo "   4. Update frontend REACT_APP_BACKEND_URL"
echo ""
