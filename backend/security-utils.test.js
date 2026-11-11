'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../security-utils');
const { csvEscape } = require('./csv');

test('HTML escaping neutralizes markup and quote breakout characters', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')">`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /const courseCard=.*safeText\(title\).*safeText\(copy\)/);
  assert.match(app, /<option value="\$\{safeText\(m\.id\)\}">\$\{safeText\(m\.name/);
});

test('CSV export neutralizes spreadsheet formula starters and quotes delimiters', () => {
  for (const payload of ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '  =1+1', '\t=1+1']) {
    assert.ok(csvEscape(payload).startsWith("'"), `expected formula starter to be neutralized: ${payload.trim()}`);
  }
  assert.equal(csvEscape('safe,"value"'), '"safe,""value"""');
});
