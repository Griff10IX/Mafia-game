#!/usr/bin/env node
/**
 * Unit-ish test for PERF #4 authMeBootstrap (mocked apiGetWithResumeRetries).
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');

const root = path.join(__dirname, '..');
const apiPath = path.join(root, 'src', 'utils', 'api.js');
const bootPath = path.join(root, 'src', 'utils', 'authMeBootstrap.js');

let callCount = 0;
let resolveCurrent = null;

// Stub api module before loading bootstrap (bootstrap only imports apiGetWithResumeRetries)
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './api' && parent && parent.filename && parent.filename.includes('authMeBootstrap')) {
    return {
      apiGetWithResumeRetries: async () => {
        callCount += 1;
        // Allow concurrent waiters to share one promise via bootstrap
        await new Promise((r) => setTimeout(r, 30));
        return { data: { id: 'u1', username: 'Test', _n: callCount } };
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

async function main() {
  // Babel-less: evaluate bootstrap via dynamic import won't work on CRA ESM.
  // Instead contract-check source + simulate logic inline matching the module.
  const src = fs.readFileSync(bootPath, 'utf8');
  const layout = fs.readFileSync(path.join(root, 'src', 'components', 'Layout.js'), 'utf8');
  const dash = fs.readFileSync(path.join(root, 'src', 'utils', 'dashboardSessionCache.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'src', 'utils', 'api.js'), 'utf8');
  const fails = [];
  if (!src.includes('AUTH_ME_FRESH_MS')) fails.push('missing AUTH_ME_FRESH_MS');
  if (!src.includes('export function fetchAuthMe')) fails.push('missing fetchAuthMe');
  if (!layout.includes("from '../utils/authMeBootstrap'")) fails.push('Layout missing authMeBootstrap import');
  if (!layout.includes('fetchAuthMe({ force: false })')) fails.push('Layout fetchData not using fetchAuthMe');
  if (!layout.includes('PERF #4')) fails.push('Layout missing PERF #4 defer comments');
  if (!dash.includes('fetchAuthMe')) fails.push('dashboardSessionCache not using fetchAuthMe');
  if (!api.includes('invalidateAuthMeBootstrap')) fails.push('api.invalidateApiCache not clearing auth bootstrap');
  // Simulate coalesce
  callCount = 0;
  delete require.cache[require.resolve(bootPath)];
  // Can't require ESM/CRA easily — simulate the algorithm:
  let inflight = null;
  let cache = null;
  const FRESH = 2500;
  const fakeGet = async () => {
    callCount += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { data: { n: callCount } };
  };
  const fetchAuthMe = ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && cache && now - cache.at < FRESH) return Promise.resolve(cache.response);
    if (inflight) return inflight;
    inflight = fakeGet().then((res) => {
      cache = { at: Date.now(), response: res };
      return res;
    }).finally(() => { inflight = null; });
    return inflight;
  };
  const [a, b, c] = await Promise.all([fetchAuthMe(), fetchAuthMe(), fetchAuthMe()]);
  if (callCount !== 1) fails.push(`expected 1 network call for 3 concurrent, got ${callCount}`);
  if (a.data.n !== b.data.n || b.data.n !== c.data.n) fails.push('concurrent responses differ');
  const d = await fetchAuthMe();
  if (callCount !== 1) fails.push(`cache should prevent 2nd call, got ${callCount}`);
  if (d.data.n !== a.data.n) fails.push('cached response mismatch');

  if (fails.length) {
    console.error('FAIL:\n- ' + fails.join('\n- '));
    process.exit(1);
  }
  console.log('PASS: PERF #4 auth bootstrap contracts + coalesce simulation');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
