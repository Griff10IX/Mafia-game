/**
 * Full mobile UI smoke as a normal (non-admin) player.
 * iPhone 13 viewport only — asserts nav stays same-tab.
 */
const { chromium, devices } = require('playwright');

const BASE = process.env.MOBILE_TEST_BASE || 'https://mafiawars.co.uk';
const TOKEN = process.env.MOBILE_TEST_TOKEN || '';
const iPhone = devices['iPhone 13'];

function fail(msg, extra) {
  console.error('FAIL:', msg, extra ? JSON.stringify(extra) : '');
  process.exit(1);
}

async function main() {
  if (!TOKEN) fail('set MOBILE_TEST_TOKEN');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone, locale: 'en-GB' });
  const page = await context.newPage();
  let extraPages = 0;
  context.on('page', () => { extraPages += 1; });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((tok) => localStorage.setItem('token', tok), TOKEN);

  await page.goto(`${BASE}/account/dashboard`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3500);

  const boot = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const j = await r.json();
    const u = j.user || j.data || j;
    return {
      ok: r.ok,
      username: u.username,
      is_admin: !!u.is_admin,
      role: u.role || null,
      path: location.pathname,
      w: window.innerWidth,
      h: window.innerHeight,
      standalone: !!(window.navigator.standalone),
      displayMode: window.matchMedia('(display-mode: standalone)').matches,
      hasBottomNav: !!document.querySelector('[data-layout="bottom-nav"]'),
      hasPocketDock: !!document.querySelector('[data-layout="pocket-dock"]'),
      hasSidebar: !!document.querySelector('[data-layout="sidebar"]'),
      linkTargets: Array.from(document.querySelectorAll('[data-layout="bottom-nav"] a, [data-layout="bottom-nav-submenu"] a, [data-layout="pocket-dock"] a'))
        .slice(0, 30)
        .map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target') })),
    };
  });
  console.log('BOOT', JSON.stringify(boot));

  if (!boot.ok) fail('auth/me failed', boot);
  if (boot.is_admin || ['admin', 'mod', 'helper'].includes(String(boot.role || '').toLowerCase())) {
    fail('expected normal user, got staff', boot);
  }
  if (boot.w > 430) fail('viewport not mobile width', boot);
  if (!boot.hasBottomNav && !boot.hasPocketDock) fail('no mobile nav chrome found', boot);

  const badTargets = (boot.linkTargets || []).filter((l) => l.target && l.target !== '_self');
  if (badTargets.length) fail('mobile nav links have target=_blank', badTargets);

  async function clickStaySameTab(locator, label) {
    const pages0 = context.pages().length;
    const extra0 = extraPages;
    const url0 = page.url();
    const count = await locator.count();
    if (!count) {
      console.log('SKIP', label, '(missing)');
      return { skipped: true };
    }
    // Ensure visible (submenu may need parent open)
    await locator.first().scrollIntoViewIfNeeded().catch(() => {});
    const popupPromise = page.waitForEvent('popup', { timeout: 2500 }).then((p) => p).catch(() => null);
    await locator.first().click({ timeout: 10000 });
    const popup = await popupPromise;
    await page.waitForTimeout(1200);
    const pages1 = context.pages().length;
    const url1 = page.url();
    if (popup || pages1 > pages0 || extraPages > extra0) {
      fail(`new tab opened for ${label}`, {
        url0, url1, pages0, pages1, extraPages, extra0, popupUrl: popup ? popup.url() : null,
      });
    }
    console.log('OK', label, `${new URL(url0).pathname} -> ${new URL(url1).pathname}`);
    return { url0, url1 };
  }

  // Direct bottom-nav links
  await clickStaySameTab(page.locator('[data-layout="bottom-nav"] a[href="/account/dashboard"]'), 'bottom-dashboard');
  await clickStaySameTab(page.locator('[data-layout="bottom-nav"] a[href="/social/inbox"]'), 'bottom-inbox');

  // Open each bottom group and click first submenu link
  const groups = page.locator('[data-layout="bottom-nav"] button[aria-haspopup="true"]');
  const gCount = await groups.count();
  console.log('GROUPS', gCount);
  for (let i = 0; i < gCount; i++) {
    await groups.nth(i).click().catch(() => {});
    await page.waitForTimeout(500);
    const subLinks = page.locator('[data-layout="bottom-nav-submenu"] a');
    const n = await subLinks.count();
    if (!n) {
      console.log('SKIP submenu', i, '(empty)');
      continue;
    }
    // click up to 2 links in this group
    for (let j = 0; j < Math.min(n, 2); j++) {
      await groups.nth(i).click().catch(() => {});
      await page.waitForTimeout(400);
      await clickStaySameTab(subLinks.nth(j), `submenu-${i}-${j}`);
    }
  }

  // Pocket dock path (if that layout is active)
  if (boot.hasPocketDock) {
    const pocketBtns = page.locator('[data-layout="pocket-dock"] button');
    const pb = await pocketBtns.count();
    for (let i = 0; i < Math.min(pb, 4); i++) {
      await pocketBtns.nth(i).click().catch(() => {});
      await page.waitForTimeout(400);
      const sheetLink = page.locator('[data-layout^="pocket-"][data-layout$="-sheet"] a').first();
      if (await sheetLink.count()) {
        await clickStaySameTab(sheetLink, `pocket-sheet-${i}`);
      }
    }
  }

  // Visit a few routes via in-page navigate (still mobile chrome)
  for (const path of ['/crime/crimes', '/game/travel', '/account/stats', '/social/forum', '/kill/attack']) {
    const pages0 = context.pages().length;
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1800);
    const stillMobile = await page.evaluate(() => ({
      w: window.innerWidth,
      path: location.pathname,
      hasNav: !!(document.querySelector('[data-layout="bottom-nav"]') || document.querySelector('[data-layout="pocket-dock"]')),
    }));
    if (context.pages().length > pages0) fail('goto spawned page', stillMobile);
    if (stillMobile.w > 430) fail('lost mobile width', stillMobile);
    console.log('PAGE', JSON.stringify(stillMobile));
  }

  // Simulate plain click on a random in-content profile/game link if any without target
  const contentLinks = page.locator('main a[href^="/"]');
  const cCount = await contentLinks.count();
  if (cCount > 0) {
    await clickStaySameTab(contentLinks.first(), 'main-internal-link');
  }

  const fatalConsole = consoleErrors.filter((e) =>
    !/ResizeObserver|ChunkLoadError|Loading CSS chunk|favicon|third-party|Script error/i.test(e)
  ).slice(0, 8);

  console.log('CONSOLE_ERRORS', JSON.stringify(fatalConsole));
  console.log(`PASS: mobile full smoke as ${boot.username} (extraPages=${extraPages}, pages=${context.pages().length})`);
  await browser.close();
}

main().catch((e) => fail(String(e && e.stack || e)));
