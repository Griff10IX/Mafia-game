# Why the browser says “Not secure” after getting SSL

You have an SSL certificate, but the browser still shows **“Not secure”** when you open the site. Here’s why and how to fix it.

---

## 1. You’re opening the site with HTTP

**Cause:** The page is loaded over **http://**, so the connection is not encrypted. The certificate is only used when you use **https://**.

**Fix:** Open the site with **https** and bookmark it:

- **https://mafiawars.co.uk**  
- or **https://www.mafiawars.co.uk** (if you use www)

Do **not** type `mafiawars.co.uk` or `http://mafiawars.co.uk` if you want the padlock.

---

## 2. HTTP is not redirecting to HTTPS

**Cause:** Nginx (or your web server) is serving the site on both port 80 (HTTP) and 443 (HTTPS). If there’s no redirect, people who type `http://...` or follow an old link stay on HTTP, so the browser shows “Not secure”.

**Fix:** Add a redirect so that all HTTP requests are sent to HTTPS.

**On the server (SSH in, then):**

1. Open the Nginx config you use for the site (often the default site):

   ```bash
   sudo nano /etc/nginx/sites-available/default
   ```

2. You should have **two** `server { ... }` blocks:
   - One that **listens on 80** and only redirects to HTTPS.
   - One that **listens on 443 ssl** and serves the app (this is the one Certbot will have set up for SSL).

   If you only have the 443 block, add this **before** it (use your real domain):

   ```nginx
   server {
       listen 80;
       server_name mafiawars.co.uk www.mafiawars.co.uk;
       return 301 https://$host$request_uri;
   }
   ```

   That sends every HTTP request to the same URL but with `https://`.

3. Save (Ctrl+O, Enter) and exit (Ctrl+X).

4. Test and reload:

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. In the browser, try **http://mafiawars.co.uk** – it should immediately change to **https://mafiawars.co.uk** and show the padlock.

---

## If it still isn’t redirecting

**1. You might be editing the wrong file.**  
Nginx only uses configs in `sites-enabled`. Check:

```bash
ls -la /etc/nginx/sites-enabled/
```

If you see **mafia-backend** (and `default` is removed), then your site is served by `mafia-backend`, not `default`. Edit that file and add the redirect block at the top:

```bash
sudo nano /etc/nginx/sites-available/mafia-backend
```

**2. Port 80 must only redirect, not serve the site.**  
If the same `server { }` block has **both** `listen 80` and `location /` (or `proxy_pass`), Nginx will serve the app on HTTP and the redirect never runs. You need **two** separate blocks:

- **Redirect-only block (listens on 80, no `location /`):**
  ```nginx
  server {
      listen 80;
      server_name mafiawars.co.uk www.mafiawars.co.uk;
      return 301 https://$host$request_uri;
  }
  ```
- **HTTPS block (listens on 443, has your SSL and app config):**  
  This block should have `listen 443 ssl;` and your `location /`, `proxy_pass`, etc. It must **not** have `listen 80;`.

If your current block has both `listen 80` and `listen 443 ssl`, **delete the line `listen 80;`** from that block and add the redirect block above so only the new block listens on 80.

**3. Check what’s actually handling port 80:**

```bash
sudo nginx -T | grep -B2 -A12 "listen 80"
```

You should see a block with `listen 80` and `return 301 https://` and no `location /` in that same block.

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Summary

| What you do | Result |
|-------------|--------|
| Open **https://mafiawars.co.uk** | Padlock, secure. |
| Open **http://mafiawars.co.uk** or **mafiawars.co.uk** | “Not secure” until you add the HTTP→HTTPS redirect above. |

After the redirect is in place, even if someone uses `http://`, they’ll be sent to `https://` and see “secure” instead of “Not secure”.
