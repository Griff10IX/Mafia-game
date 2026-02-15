# 🚀 Deploy to Your Existing DigitalOcean Droplet

**Quick deployment guide for your existing droplet**

---

## 🏃 QUICK START (30 Minutes)

### Step 1: SSH Into Your Droplet
```bash
ssh root@YOUR_DROPLET_IP
```

Replace `YOUR_DROPLET_IP` with your actual DigitalOcean droplet IP address.

---

## 🔒 Step 2: Secure MongoDB IMMEDIATELY

### Check if MongoDB is installed:
```bash
mongosh --version
```

If not installed, install it:
```bash
# Import MongoDB public key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
   sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Install
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start
sudo systemctl start mongod
sudo systemctl enable mongod
```

### CRITICAL: Enable Authentication NOW
```bash
# Connect to MongoDB
mongosh

# Create admin user
use admin
db.createUser({
  user: "adminMafia",
  pwd: "CREATE_A_STRONG_PASSWORD_HERE",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase" ]
})

# Create app user
use mafia_game
db.createUser({
  user: "mafiaApp",
  pwd: "ANOTHER_STRONG_PASSWORD_HERE",
  roles: [ { role: "readWrite", db: "mafia_game" } ]
})

exit
```

### Enable Auth in Config:
```bash
sudo nano /etc/mongod.conf
```

Find the `security:` section and make it look like this:
```yaml
security:
  authorization: enabled

net:
  bindIp: 127.0.0.1
  port: 27017
```

**Important:** Make sure `bindIp` is `127.0.0.1`, NOT `0.0.0.0`!

```bash
# Restart MongoDB
sudo systemctl restart mongod

# Verify it's working
mongosh -u adminMafia -p --authenticationDatabase admin
```

---

## 🛡️ Step 3: Configure Firewall

```bash
# Check current firewall status
sudo ufw status

# If inactive, configure it:
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# CRITICAL: Do NOT allow port 27017
# sudo ufw deny 27017/tcp  # (optional explicit deny)

sudo ufw enable
```

---

## 📦 Step 4: Install System Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.11 (if not installed)
sudo apt install -y python3.11 python3.11-venv python3-pip

# Install Nginx
sudo apt install -y nginx

# Install certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

# Install Git (if not installed)
sudo apt install -y git
```

---

## 💻 Step 5: Deploy Your Backend

### 5.1 Clone Your Repository
```bash
cd ~
git clone YOUR_GITHUB_REPO_URL mafia-game
cd mafia-game/backend
```

If you don't have a Git repo, upload via SCP:
```bash
# From your local machine:
scp -r "c:\Users\jakeg\Desktop\Game files mafia" root@YOUR_DROPLET_IP:/root/mafia-game
```

### 5.2 Create Virtual Environment
```bash
cd ~/mafia-game/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 5.3 Create Production .env File
```bash
nano .env
```

Paste this (UPDATE THE PASSWORDS):
```env
# MongoDB with authentication
MONGO_URL="mongodb://mafiaApp:ANOTHER_STRONG_PASSWORD_HERE@localhost:27017/mafia_game?authSource=mafia_game"
DB_NAME="mafia_game"

# CORS - Update with your frontend domain
CORS_ORIGINS="https://your-frontend.vercel.app,http://YOUR_DROPLET_IP"

# JWT Secret - Generate new one with:
# python3 -c "import secrets; print(secrets.token_urlsafe(32))"
JWT_SECRET_KEY="PASTE_NEW_SECRET_HERE"

# API Keys (copy from your local .env)
THE_ODDS_API_KEY=2c788302be85d5d5f05a00695b9fb183
GIPHY_API_KEY=KLBJLRTEBF3LegHs2KKJjty541HstcpD
TELEGRAM_BOT_TOKEN=8227124202:AAGhj8e8WRrhwXkvGm1IB-iTlR7xRL655II
TELEGRAM_CHAT_ID=-5266781777

PRODUCTION=true
```

Save with: `Ctrl+O`, `Enter`, `Ctrl+X`

---

## 🎯 Step 6: Create Systemd Service

```bash
sudo nano /etc/systemd/system/mafia-backend.service
```

Paste this (UPDATE USERNAME if not 'root'):
```ini
[Unit]
Description=Mafia Game Backend API
After=network.target mongod.service
Requires=mongod.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/mafia-game/backend
Environment="PATH=/root/mafia-game/backend/venv/bin"
ExecStart=/root/mafia-game/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=10
StandardOutput=append:/root/mafia-backend.log
StandardError=append:/root/mafia-backend-error.log

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable mafia-backend
sudo systemctl start mafia-backend

# Check status
sudo systemctl status mafia-backend
```

---

## 🌐 Step 7: Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/mafia-backend
```

Paste this (UPDATE YOUR_DROPLET_IP):
```nginx
server {
    listen 80;
    server_name YOUR_DROPLET_IP;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;
    
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
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mafia-backend /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

## ✅ Step 8: Test Your Deployment

```bash
# Test locally
curl http://localhost:8000/

# Test from outside (from your local machine)
curl http://YOUR_DROPLET_IP/
```

You should see: `{"message":"Mafia API","docs":"/docs","api":"/api"}`

---

## 🔄 Step 9: Deploy Frontend to Vercel

### Update your frontend .env:
Create `c:\Users\jakeg\Desktop\Game files mafia\.env.production`:
```env
REACT_APP_BACKEND_URL=http://YOUR_DROPLET_IP/api
```

### Deploy:
```bash
# From your local machine
cd "c:\Users\jakeg\Desktop\Game files mafia"
npm install -g vercel
vercel login
vercel --prod
```

### Add Environment Variable in Vercel:
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add: `REACT_APP_BACKEND_URL` = `http://YOUR_DROPLET_IP/api`
3. Redeploy

---

## 💾 Step 10: Set Up Automated Backups

### Create backup script:
```bash
mkdir -p ~/backups
nano ~/backup-mongodb.sh
```

Paste this (UPDATE PASSWORDS):
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/backups"
MONGO_USER="adminMafia"
MONGO_PASS="CREATE_A_STRONG_PASSWORD_HERE"

# Create backup
mongodump --username="$MONGO_USER" --password="$MONGO_PASS" --authenticationDatabase=admin --out="$BACKUP_DIR/backup_$DATE"

# Compress
cd "$BACKUP_DIR"
tar -czf "backup_$DATE.tar.gz" "backup_$DATE"
rm -rf "backup_$DATE"

# Keep only last 7 days
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete

echo "$(date): Backup completed - backup_$DATE.tar.gz" >> "$BACKUP_DIR/backup.log"
```

```bash
# Make executable
chmod +x ~/backup-mongodb.sh

# Test it
./backup-mongodb.sh

# Schedule daily backups at 2 AM
crontab -e
# Add this line:
0 2 * * * /root/backup-mongodb.sh
```

---

## 🔍 Step 11: Investigate the Ransomware Attack

### Run the status checker:
```bash
cd ~/mafia-game/backend
source venv/bin/activate
python3 check-database-status.py
```

This will show you:
- ✅ When your database was wiped (based on oldest user creation date)
- ✅ What collections exist
- ✅ Any ransomware notes still in the DB

### Remove the ransomware note:
```bash
python3 remove-ransomware.py
```

---

## 📊 Useful Commands

```bash
# View backend logs
sudo journalctl -u mafia-backend -f

# Restart backend
sudo systemctl restart mafia-backend

# Check MongoDB status
sudo systemctl status mongod

# View MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Check if backend is responding
curl http://localhost:8000/

# Update code from git
cd ~/mafia-game && git pull
cd backend && source venv/bin/activate && pip install -r requirements.txt
sudo systemctl restart mafia-backend
```

---

## 🆘 Troubleshooting

### Backend won't start:
```bash
sudo journalctl -u mafia-backend -n 100 --no-pager
```

### Can't connect to MongoDB:
```bash
mongosh -u adminMafia -p --authenticationDatabase admin
```

### Port 8000 already in use:
```bash
sudo netstat -tlnp | grep 8000
sudo kill -9 PID_NUMBER
```

---

## ✨ What Your IP Address?

To find your droplet's IP:
```bash
# On the droplet
curl ifconfig.me
```

Or check the DigitalOcean dashboard.

---

## 🎯 Next Steps After Deployment

1. ✅ Test the API: `http://YOUR_DROPLET_IP/api/docs`
2. ✅ Update your frontend to point to new backend
3. ✅ Run `check-database-status.py` to investigate the attack
4. ✅ Set up SSL if you have a domain (optional but recommended)
5. ✅ Enable DigitalOcean monitoring (free, in dashboard)

---

Need help with any step? Just ask!
