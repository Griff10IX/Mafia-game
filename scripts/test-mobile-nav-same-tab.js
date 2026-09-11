/**
 * Mobile UI smoke: iPhone viewport, normal (non-admin) player.
 * Verifies nav clicks stay in ONE page context (no new tab).
 *
 * Usage (after deploy):
 *   set MOBILE_TEST_TOKEN=...   # or script mints via SSH helper
 *   node scripts/test-mobile-nav-same-tab.js
 */
const { chromium, devices } = require('playwright');

const BASE = process.env.MOBILE_TEST_BASE || 'https://mafiawars.co.uk';
const TOKEN = process.env.MOBILE_TEST_TOKEN || '';
const iPhone = devices['iPhone 13'];

async function main() {
  if (!TOKEN) {
    console.error('FAIL: set MOBILE_TEST_TOKEN (JWT for a normal non-admin user)');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iPhone,
    locale: 'en-GB',
    // Emulate Safari-ish UA already in iPhone device
  });

  let popupCount = 0;
  context.on('page', () => { popupCount += 1; });

  const page = await context.newPage();
  // Seed auth before first app boot
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((tok) => {
    localStorage.setItem('token', tok);
  }, TOKEN);

  await page.goto(`${BASE}/account/dashboard`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(2500);

  const bootUser = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const j = await r.json();
      const u = j.user || j.data || j;
      return {
        ok: r.ok,
        username: u.username,
        is_admin: u.is_admin,
        role: u.role,
        path: location.pathname,
        w: window.innerWidth,
      };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  });
  console.log('BOOT', JSON.stringify(bootUser));
  if (!bootUser.ok) {
    console.error('FAIL: auth/me failed');
    process.exit(1);
  }
  if (bootUser.is_admin || ['admin', 'mod', 'helper'].includes(String(bootUser.role || '').toLowerCase())) {
    console.error('FAIL: not a normal user');
    process.exit(1);
  }
  if (bootUser.w > 500) {
    console.error('FAIL: viewport not mobile width', bootUser.w);
    process.exit(1);
  }

  const pagesBefore = context.pages().length;
  const routes = [
    { sel: 'a[href="/crime/crimes"], a[href="/crime/jail"]', name: 'crime-ish' },
    { sel: 'a[href="/social/inbox"]', name: 'inbox' },
    { sel: 'a[href="/account/dashboard"]', name: 'dashboard' },
    { sel: 'a[href="/game/travel"], a[href="/travel"]', name: 'travel' },
  ];

  const results = [];
  for (const r of routes) {
    const locBefore = page.url();
    const pages0 = context.pages().length;
    const el = page.locator(r.sel).first();
    const count = await el.count();
    if (!count) {
      results.push({ name: r.name, skipped: true, reason: 'selector missing' });
      continue;
    }
    // Force visible: open bottom menus if needed
    await el.click({ timeout: 8000 }).catch(async () => {
      // try opening a bottom group first
      const groupBtn = page.locator('[data-layout="bottom-nav"] button').first();
      if (await groupBtn.count()) await groupBtn.click().catch(() => {});
      await el.click({ timeout: 8000 });
    });
    await page.waitForTimeout(1200);
    const pages1 = context.pages().length;
    const locAfter = page.url();
    const openedNew = pages1 > pages0 || popupCount > 0;
    results.push({
      name: r.name,
      locBefore,
      locAfter,
      pages0,
      pages1,
      popupCount,
      openedNew,
      sameTab: !openedNew,
    });
    if (openedNew) {
      console.error('FAIL: new tab/page opened for', r.name, results[results.length - 1]);
      await browser.close();
      process.exit(1);
    }
  }

  // Extra: click several bottom-nav submenu links if present
  const groups = page.locator('[data-layout="bottom-nav"] button[aria-haspopup="true"]');
  const gCount = await groups.count();
  for (let i = 0; i < Math.min(gCount, 4); i++) {
    await groups.nth(i).click().catch(() => {});
    await page.waitForTimeout(400);
    const sub = page.locator('[data-layout="bottom-nav-submenu"] a').first();
    if (await sub.count()) {
      const pages0 = context.pages().length;
      await sub.click();
      await page.waitForTimeout(1000);
      if (context.pages().length > pages0) {
        console.error('FAIL: submenu opened new tab');
        process.exit(1);
      }
      results.push({ name: `submenu-${i}`, sameTab: true, path: page.url() });
    }
  }

  console.log('RESULTS', JSON.stringify(results, null, 2));
  console.log(`PASS: mobile same-tab nav (pages=${context.pages().length}, startPages=${pagesBefore}, popups=${popupCount})`);
  await browser.close();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
