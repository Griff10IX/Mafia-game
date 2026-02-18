#!/bin/bash
# Setup maintenance page for nginx
# Run this once on the server: bash setup-maintenance.sh

echo "Setting up maintenance page..."

# Upgrade existing config: if we have 502 503 504 but not 500, add 500 so maintenance shows on restart
if grep -q "error_page 502 503 504 /maintenance.html" /etc/nginx/sites-available/default && ! grep -q "error_page 500 502 503 504" /etc/nginx/sites-available/default; then
    echo "Upgrading nginx config to also show maintenance on 500..."
    sed -i 's|error_page 502 503 504 /maintenance.html|error_page 500 502 503 504 /maintenance.html|' /etc/nginx/sites-available/default
    echo "✓ Updated to include 500"
fi

# Check if nginx config already has error page setup (500 = Internal Server Error when backend is down/restarting)
if grep -q "error_page 500 502 503 504 /maintenance.html" /etc/nginx/sites-available/default; then
    echo "✓ Maintenance page already configured in nginx"
else
    echo "Adding maintenance page config to nginx..."
    
    # Backup nginx config
    cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup
    
    # Add error page configuration before the last closing brace (500 = shown when backend restarting)
    sed -i '/^}$/i \
    # Show maintenance page when backend is down or restarting (500/502/503/504)\
    error_page 500 502 503 504 /maintenance.html;\
    location = /maintenance.html {\
        root /var/www/html;\
        internal;\
    }\
' /etc/nginx/sites-available/default
    
    echo "✓ Added maintenance page config"
fi

# Test nginx config
echo "Testing nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    echo "✓ Nginx config is valid"
    echo "Reloading nginx..."
    systemctl reload nginx
    echo "✓ Done! Maintenance page is now active."
    echo ""
    echo "The maintenance page will show automatically when the backend is down or restarting."
else
    echo "✗ Nginx config test failed! Rolling back..."
    cp /etc/nginx/sites-available/default.backup /etc/nginx/sites-available/default
    echo "Restored backup. Please check nginx config manually."
fi
