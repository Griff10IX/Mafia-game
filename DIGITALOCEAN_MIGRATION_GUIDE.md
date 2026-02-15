# 🌊 DigitalOcean Migration Guide - Mafia Game

## 🎯 Migration Plan Overview

### What We'll Set Up:
1. **DigitalOcean Droplet** (Server) - Ubuntu 24.04 LTS
2. **MongoDB** with proper authentication & firewall
3. **Backend API** (FastAPI/Python)
4. **Frontend** (React) on Vercel
5. **Backups** (automated daily)
6. **SSL/HTTPS** with Let's Encrypt

---

## 📋 STEP 1: Create DigitalOcean Account & Droplet

### 1.1 Sign Up
- Go to https://www.digitalocean.com
- Use referral link for $200 free credits (60 days)
- Add payment method

### 1.2 Create Droplet
**Recommended Configuration:**
- **Image:** Ubuntu 24.04 LTS
- **Plan:** Basic - Regular ($12/month)
  - 2 GB RAM / 1 CPU
  - 50 GB SSD
  - 2 TB transfer
- **Datacenter:** Choose closest to your users
- **Authentication:** SSH Key (create one if needed)
- **Hostname:** mafia-game-server

### 1.3 Cost Estimate
- Droplet: $12/month
- Backups (optional): +20% = $2.40/month
- **Total: ~$15/month**

---

## 🔒 STEP 2: Initial Server Security Setup

### 2.1 SSH Into Your Server
```bash
ssh root@your_droplet_ip
```

### 2.2 Create Non-Root User
```bash
# Create new user
adduser mafia
usermod -aG sudo mafia

# Copy SSH keys
rsync --archive --chown=mafia:mafia ~/.ssh /home/mafia

# Switch to new user
su - mafia
```

### 2.3 Configure Firewall
```bash
# Enable UFW firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# MongoDB port 27017 - DO NOT expose to public!
# We'll use it only locally (no ufw rule needed)
```

---

## 🗄️ STEP 3: Install & Secure MongoDB

### 3.1 Install MongoDB
```bash
# Import MongoDB public key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
   sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Install
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### 3.2 CRITICAL: Enable Authentication
```bash
# Connect to MongoDB
mongosh

# Create admin user
use admin
db.createUser({
  user: "adminUser",
  pwd: "CHANGE_THIS_STRONG_PASSWORD_123!",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase" ]
})

# Create database user for your app
use mafia_game
db.createUser({
  user: "mafiaAppUser",
  pwd: "ANOTHER_STRONG_PASSWORD_456!",
  roles: [ { role: "readWrite", db: "mafia_game" } ]
})

exit
```

### 3.3 Enable Authentication in Config
```bash
# Edit MongoDB config
sudo nano /etc/mongod.conf
```

Add these lines:
```yaml
security:
  authorization: enabled

net:
  bindIp: 127.0.0.1  # ONLY listen locally, never 0.0.0.0!
  port: 27017
```

```bash
# Restart MongoDB
sudo systemctl restart mongod
```

### 3.4 Test Authentication
```bash
# This should fail (no auth)
mongosh

# This should work
mongosh -u adminUser -p --authenticationDatabase admin
```

---

## 🔧 STEP 4: Install Backend Dependencies

### 4.1 Install Python & System Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.11
sudo apt install -y python3.11 python3.11-venv python3-pip

# Install build tools
sudo apt install -y build-essential libssl-dev libffi-dev python3-dev

# Install Nginx (web server)
sudo apt install -y nginx

# Install Certbot (SSL certificates)
sudo apt install -y certbot python3-certbot-nginx
```

### 4.2 Clone Your Project
```bash
cd ~
git clone YOUR_GITHUB_REPO_URL mafia-game
cd mafia-game/backend
```

### 4.3 Set Up Python Virtual Environment
```bash
# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

## ⚙️ STEP 5: Configure Backend

### 5.1 Create Production .env File
```bash
cd ~/mafia-game/backend
nano .env
```

```env
# MongoDB - SECURE CONNECTION STRING
MONGO_URL="mongodb://mafiaAppUser:ANOTHER_STRONG_PASSWORD_456!@localhost:27017/mafia_game?authSource=mafia_game"
DB_NAME="mafia_game"

# CORS - Update with your frontend URL
CORS_ORIGINS="https://your-frontend.vercel.app,https://mafia.yourdomain.com"

# JWT Secret - Generate new one
JWT_SECRET_KEY="GENERATE_NEW_SECRET_HERE"

# API Keys (use your existing ones)
THE_ODDS_API_KEY=your_key_here
GIPHY_API_KEY=your_key_here
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Production flag
PRODUCTION=true
```

**Generate a new JWT secret:**
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 5.2 Create Systemd Service
```bash
sudo nano /etc/systemd/system/mafia-backend.service
```

```ini
[Unit]
Description=Mafia Game Backend API
After=network.target mongod.service
Requires=mongod.service

[Service]
Type=simple
User=mafia
WorkingDirectory=/home/mafia/mafia-game/backend
Environment="PATH=/home/mafia/mafia-game/backend/venv/bin"
ExecStart=/home/mafia/mafia-game/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable mafia-backend
sudo systemctl start mafia-backend

# Check status
sudo systemctl status mafia-backend
```

---

## 🌐 STEP 6: Configure Nginx & SSL

### 6.1 Configure Domain (if you have one)
Point your domain to your DigitalOcean droplet IP:
- `api.yourdomain.com` → A record → `your_droplet_ip`

### 6.2 Create Nginx Configuration
```bash
sudo nano /etc/nginx/sites-available/mafia-backend
```

```nginx
server {
    listen 80;
    server_name api.yourdomain.com your_droplet_ip;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;
    
    # Max request size
    client_max_body_size 10M;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mafia-backend /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 6.3 Enable SSL with Let's Encrypt (if using domain)
```bash
sudo certbot --nginx -d api.yourdomain.com
```

---

## 💾 STEP 7: Set Up Automated Backups

### 7.1 Create Backup Script
```bash
mkdir -p ~/backups
nano ~/backup-mongodb.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/mafia/backups"
MONGO_USER="adminUser"
MONGO_PASS="CHANGE_THIS_STRONG_PASSWORD_123!"

# Create backup
mongodump --username="$MONGO_USER" --password="$MONGO_PASS" --authenticationDatabase=admin --out="$BACKUP_DIR/backup_$DATE"

# Compress
cd "$BACKUP_DIR"
tar -czf "backup_$DATE.tar.gz" "backup_$DATE"
rm -rf "backup_$DATE"

# Keep only last 7 days
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete

echo "Backup completed: backup_$DATE.tar.gz"
```

```bash
# Make executable
chmod +x ~/backup-mongodb.sh

# Test it
./backup-mongodb.sh
```

### 7.2 Schedule Daily Backups
```bash
crontab -e
```

Add this line (runs daily at 2 AM):
```
0 2 * * * /home/mafia/backup-mongodb.sh >> /home/mafia/backup.log 2>&1
```

### 7.3 Optional: Upload to DigitalOcean Spaces (S3-compatible storage)
```bash
# Install s3cmd
sudo apt install -y s3cmd

# Configure (you'll need Spaces access key)
s3cmd --configure

# Modify backup script to upload
# Add at end of backup-mongodb.sh:
# s3cmd put backup_$DATE.tar.gz s3://your-bucket-name/backups/
```

---

## 🚀 STEP 8: Deploy Frontend to Vercel

### 8.1 Update Frontend API URL
```bash
cd ~/mafia-game
nano .env.production
```

```env
REACT_APP_BACKEND_URL=https://api.yourdomain.com/api
```

### 8.2 Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
cd ~/mafia-game
vercel --prod
```

### 8.3 Configure Environment Variables in Vercel
- Go to Vercel dashboard → Project Settings → Environment Variables
- Add: `REACT_APP_BACKEND_URL=https://api.yourdomain.com/api`

---

## ✅ STEP 9: Security Checklist

### Must-Do Security Items:
- [x] MongoDB has authentication enabled
- [x] MongoDB only listens on 127.0.0.1 (localhost)
- [x] Firewall (UFW) configured (only 80, 443, SSH open)
- [x] Non-root user created
- [x] SSH key authentication (disable password auth)
- [x] SSL/HTTPS enabled
- [x] Automated backups configured
- [ ] Set up monitoring (DigitalOcean Monitoring - free)
- [ ] Configure fail2ban for SSH protection
- [ ] Set up log rotation

### Optional but Recommended:
```bash
# Install fail2ban (blocks repeated SSH attacks)
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Disable password SSH (only allow keys)
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```

---

## 📊 STEP 10: Monitoring & Maintenance

### 10.1 Enable DigitalOcean Monitoring (Free)
- Droplet → Settings → Enable Monitoring
- Set up alerts for CPU, RAM, disk usage

### 10.2 Check Logs
```bash
# Backend logs
sudo journalctl -u mafia-backend -f

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log
```

### 10.3 Update Backend Code
```bash
cd ~/mafia-game
git pull origin main
cd backend
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart mafia-backend
```

---

## 💰 Cost Breakdown

| Item | Cost | Notes |
|------|------|-------|
| Droplet (2GB) | $12/mo | Can scale up/down |
| Backups | $2.40/mo | Optional (20% of droplet cost) |
| Domain | ~$12/year | Optional (use IP otherwise) |
| Spaces (Storage) | $5/mo | Optional (for off-site backups) |
| **Total** | **$15-20/mo** | Very affordable! |

---

## 🆘 Troubleshooting

### Backend won't start:
```bash
# Check logs
sudo journalctl -u mafia-backend -n 50

# Check if MongoDB is running
sudo systemctl status mongod

# Check if port 8000 is in use
sudo netstat -tlnp | grep 8000
```

### Can't connect to MongoDB:
```bash
# Test connection
mongosh -u mafiaAppUser -p --authenticationDatabase mafia_game

# Check MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log
```

### Nginx errors:
```bash
# Test config
sudo nginx -t

# Check error log
sudo tail -f /var/log/nginx/error.log
```

---

## 🎓 Next Steps After Migration

1. **Migrate Your Data** (if you have a backup)
   ```bash
   # Restore from backup
   mongorestore --username=mafiaAppUser --password=PASSWORD --authenticationDatabase=mafia_game backup_folder/
   ```

2. **Update DNS** (point your domain to new IP)

3. **Test Everything**
   - User registration
   - Login
   - Game features
   - Payments (if applicable)

4. **Monitor for 24-48 hours**
   - Check CPU/RAM usage
   - Check error logs
   - Watch for any issues

5. **Set Up Alerts**
   - DigitalOcean email alerts
   - Telegram alerts for critical errors

---

## 🔐 NEVER AGAIN: Ransomware Prevention

✅ **What You'll Have:**
- Authentication on MongoDB (username/password required)
- MongoDB not exposed to internet (127.0.0.1 only)
- Firewall blocking unauthorized access
- Daily automated backups
- Backups stored separately from live database
- Monitoring and alerts

**This setup makes ransomware attacks virtually impossible!** 🛡️

---

Need help with the migration? I'm here to assist every step of the way!
