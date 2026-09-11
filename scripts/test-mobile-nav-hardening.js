/**
 * Unit-ish checks for mobile nav same-tab hardening (no browser required).
 */
const fs = require('fs');
const path = require('path');
const layout = fs.readFileSync(path.join(__dirname, '../src/components/Layout.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
const forum = fs.readFileSync(path.join(__dirname, '../src/utils/forumContent.js'), 'utf8');
const fails = [];

if (!/function normalizeLinkTo\(/.test(layout)) fails.push('missing normalizeLinkTo');
if (!/navigate\(dest\)/.test(layout)) fails.push('SameRouteAwareLink must call navigate(dest)');
if (!/e\.preventDefault\(\)/.test(layout)) fails.push('missing preventDefault');
if (!/isPlainPrimary/.test(layout)) fails.push('missing isPlainPrimary gate');
if (!/opensNewContext/.test(layout)) fails.push('missing opensNewContext gate');
if (!/-webkit-touch-callout:\s*none/.test(css)) fails.push('missing touch-callout none on nav');
if (!/function forumAnchorAttrs\(/.test(forum)) fails.push('missing forumAnchorAttrs');
if (/target="_blank" rel="noopener noreferrer" class="forum-content-link"/.test(forum)) {
  fails.push('forum still hardcodes target=_blank for all urls');
}

if (fails.length) {
  console.error('FAIL:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('PASS: mobile same-tab nav hardening present');
