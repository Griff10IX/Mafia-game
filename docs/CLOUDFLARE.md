# Cloudflare in front of nginx + React SPA

Use this when `mafiawars.co.uk` is **orange-cloud proxied** through Cloudflare to your droplet (nginx serves `build/`, `/api` → FastAPI).

## Symptoms this addresses

- **503 Service Unavailable** (sometimes **“from prefetch cache”** in Chrome) on routes like `/account/dashboard` or `/game/help-desk`
- **Stale** or **broken** pages after deploy
- **Rocket Loader** or minify breaking scripts (stack traces mention `rocket-loader.min.js`)

## 1. DNS

- **A** (or **AAAA**) record points to your **origin** (droplet) public IP.
- **Proxied** (orange cloud) = traffic goes through Cloudflare. **DNS only** (grey) = direct to origin; no CF cache/WAF (good for debugging).

## 2. SSL/TLS

**SSL/TLS → Overview**

- Set mode to **Full (strict)** so Cloudflare always uses HTTPS to your origin. Your origin must present a **valid** certificate (e.g. Let’s Encrypt on nginx).
- Turn on **Always Use HTTPS**.

If you use **Flexible** (browser→HTTPS, CF→HTTP), cookies and redirects can misbehave; avoid it for this stack.

## 3. Caching (most important for SPA 503 / stale HTML)

Default should **not** be “cache the whole site as static.”

**Caching → Configuration**

- **Caching Level**: **Standard** (not tuned toward “cache everything” at the zone).

**Caching → Cache Rules** (recommended)

1. **Bypass cache for API**  
   - If **URI Path** **starts with** `/api` → **Bypass cache**.

2. **Do not treat the SPA as a long-lived cached document**  
   - Your nginx config should send **`Cache-Control: no-store`** for `index.html` (see `scripts/nginx-mafia-https.conf.example`). After that, either:
   - Rely on **Standard** + origin headers, or  
   - Add a rule: for paths that are **not** static assets, **Respect origin** / short edge TTL.  
   Practical minimum: **no Page Rule** like “Cache Level: Cache Everything” for `*mafiawars.co.uk/*`.

3. **Origin request body size (avoids HTTP 413 on uploads)**  
   Nginx’s default **`client_max_body_size`** is **1m**. Avatar or other large JSON bodies can exceed that and fail with **413** before FastAPI runs. Set something like **`client_max_body_size 10M;`** in your HTTPS `server` block (see `scripts/nginx-mafia-https.conf.example`), then `sudo nginx -t && sudo systemctl reload nginx`.

**After deploy**

- **Caching → Purge Cache → Purge Everything** (or purge by prefix) once nginx/build are updated.

## 4. Speed / optimization

**Speed → Optimization**

- **Rocket Loader**: **Off** (it defers JS and often appears in stack traces; can interact badly with SPAs).

Optional: if you see odd JS issues, temporarily disable **Auto Minify** for JS/CSS to test.

## 5. Restore visitor IP (logs and rate limits)

So nginx/access logs show the user, not Cloudflare:

- Follow Cloudflare’s guide: [Restore original visitor IPs](https://developers.cloudflare.com/fundamentals/setup/restore-original-visitor-IP/)  
  (`set_real_ip_from` + `real_ip_header CF-Connecting-IP`).

Your app already prefers `CF-Connecting-IP` in some routes; nginx still benefits from real IP in logs.

## 6. Web Application Firewall

If `/api` returns **403** or odd blocks, check **Security → Events** and add **WAF exceptions** for `/api/*` if needed (only after confirming false positives).

## 7. Browser-side “prefetch cache”

If DevTools shows **503 (from prefetch cache)** but `curl --resolve yourdomain:443:127.0.0.1 https://yourdomain/` returns **200**:

- Hard refresh, **clear site data** for the domain, or test in a private window.  
- Chrome can reuse a **failed prefetch**; fixing CF/cache above prevents new bad entries.

## 8. Quick origin check (on the droplet)

```bash
curl -I --resolve mafiawars.co.uk:443:127.0.0.1 https://mafiawars.co.uk/
curl -I --resolve mafiawars.co.uk:443:127.0.0.1 https://mafiawars.co.uk/account/dashboard
```

Expect **HTTP/2 200** and **`content-type: text/html`** for both if `try_files … /index.html` is configured.

---

Apply settings in the Cloudflare dashboard for the zone that serves **mafiawars.co.uk**; no app code change is required for the above.
