/**
 * Overnight test bot: auto login, then loop crimes, GTA, and organised crime.
 * Usage: set EMAIL, PASSWORD (and optional BASE_URL) in .env or env, then run:
 *   node scripts/run-overnight.js
 * Stop with Ctrl+C.
 */

const fs = require('fs');
const path = require('path');

// Load .env from project root if present
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    });
  }
}
loadEnv();

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const API = `${BASE_URL}/api`;
const EMAIL = process.env.EMAIL || process.env.MAFIA_EMAIL;
const PASSWORD = process.env.PASSWORD || process.env.MAFIA_PASSWORD;
const LOOP_SECONDS = Math.max(15, parseInt(process.env.LOOP_SECONDS, 10) || 30);

function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = level === 'err' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
  console.log(`${ts} [${prefix}] ${msg}`);
}

async function request(method, pathname, body = null, token = null) {
  const url = `${API}${pathname}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
  let res, text;
  try {
    res = await fetch(url, opts);
    text = await res.text();
  } catch (err) {
    const cause = err.cause || err;
    if (cause?.code === 'ECONNREFUSED') {
      log('Connection refused. Is the backend running? Start it with:', 'err');
      log('  cd backend && uvicorn server:app --reload', 'err');
      log(`  Then ensure it is listening on ${BASE_URL}`, 'err');
    }
    throw err;
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}
  if (!res.ok) {
    const detail = data?.detail || text || res.statusText;
    throw new Error(`${res.status} ${pathname}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data;
}

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set EMAIL and PASSWORD (or MAFIA_EMAIL, MAFIA_PASSWORD) in .env or environment');
  }
  const data = await request('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (!data?.token) throw new Error('Login did not return a token');
  log(`Logged in as ${data.user?.username || EMAIL}`);
  return data.token;
}

async function runCrimes(token) {
  const crimes = await request('GET', '/crimes', null, token);
  if (!Array.isArray(crimes)) return 0;
  const now = new Date();
  let done = 0;
  for (const c of crimes) {
    const can = c.can_commit === true;
    const next = c.next_available ? new Date(c.next_available) : null;
    const offCooldown = !next || next <= now;
    if (!can && !offCooldown) continue;
    try {
      const result = await request('POST', `/crimes/${c.id}/commit`, null, token);
      if (result?.success) {
        log(`Crime ${c.name}: ${result.message || 'success'}`);
        done++;
      } else {
        log(`Crime ${c.name}: ${result?.message || 'failed'}`, 'warn');
      }
    } catch (e) {
      if (e.message.includes('cooldown') || e.message.includes('jail')) {
        log(`Crime ${c.name}: ${e.message}`, 'warn');
      } else {
        log(`Crime ${c.name}: ${e.message}`, 'err');
      }
    }
  }
  return done;
}

async function runGta(token) {
  const options = await request('GET', '/gta/options', null, token);
  if (!Array.isArray(options)) return 0;
  const now = new Date();
  const globalUntil = options[0]?.cooldown_until ? new Date(options[0].cooldown_until) : null;
  if (globalUntil && globalUntil > now) return 0;
  const option = options.find((o) => o.unlocked);
  if (!option) return 0;
  try {
    const result = await request('POST', '/gta/attempt', { option_id: option.id }, token);
    if (result?.success) {
      log(`GTA ${option.name}: ${result.message || 'success'}`);
      return 1;
    }
    if (result?.jailed) log(`GTA: jailed - ${result.message}`, 'warn');
    else log(`GTA ${option.name}: ${result?.message || 'failed'}`, 'warn');
  } catch (e) {
    if (e.message.includes('cooldown') || e.message.includes('jail')) {
      log(`GTA: ${e.message}`, 'warn');
    } else {
      log(`GTA: ${e.message}`, 'err');
    }
  }
  return 0;
}

async function runOrganisedCrime(token) {
  const status = await request('GET', '/oc/status', null, token);
  const until = status?.cooldown_until ? new Date(status.cooldown_until) : null;
  if (until && until > new Date()) return 0;
  const config = await request('GET', '/oc/config', null, token);
  const jobs = config?.jobs || [];
  const job = jobs[0];
  if (!job) return 0;
  const payload = {
    job_id: job.id,
    driver: 'self',
    weapons: 'npc',
    explosives: 'npc',
    hacker: 'npc',
    driver_pct: 25,
    weapons_pct: 25,
    explosives_pct: 25,
    hacker_pct: 25,
  };
  try {
    const result = await request('POST', '/oc/execute', payload, token);
    if (result?.success) {
      log(`OC ${job.name}: ${result.message || 'success'}`);
      return 1;
    }
    log(`OC ${job.name}: ${result?.message || 'failed'}`, 'warn');
  } catch (e) {
    if (e.message.includes('jail') || e.message.includes('money') || e.message.includes('afford')) {
      log(`OC: ${e.message}`, 'warn');
    } else {
      log(`OC: ${e.message}`, 'err');
    }
  }
  return 0;
}

async function tick(token) {
  const me = await request('GET', '/auth/me', null, token);
  if (me?.in_jail) {
    log('In jail — skipping crimes/GTA/OC until released');
    return;
  }
  await runCrimes(token);
  await runGta(token);
  await runOrganisedCrime(token);
}

async function main() {
  log(`Base URL: ${API}`);
  log(`Loop interval: ${LOOP_SECONDS}s`);
  let token = await login();
  log('Starting overnight loop (Ctrl+C to stop)');
  let round = 0;
  for (;;) {
    round++;
    try {
      await tick(token);
    } catch (e) {
      if (e.message.includes('401') || e.message.includes('credentials') || e.message.includes('token')) {
        log('Token expired, re-login');
        token = await login();
      } else {
        log(String(e.message), 'err');
      }
    }
    await new Promise((r) => setTimeout(r, LOOP_SECONDS * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
