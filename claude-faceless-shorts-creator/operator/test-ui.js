/**
 * test-ui.js — dashboard regression harness.
 * Executes operator/public/app.js in Node with a DOM shim against the live
 * server and renders every tab, failing on any thrown error.
 * Run with the server up:  node operator/test-ui.js
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3457';
const SRC = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');

const stubEl = () => ({
  innerHTML: '', textContent: '', className: '', hidden: false, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, append() {}, remove() {}, onclick: null,
});
const elements = new Map();
global.document = {
  querySelector(sel) {
    if (sel === '.nav-item') return null;
    if (!elements.has(sel)) elements.set(sel, stubEl());
    return elements.get(sel);
  },
  querySelectorAll() { return []; },
  createElement() { return stubEl(); },
};
global.localStorage = { getItem: () => null, setItem() {} };
global.window = global; // browser semantics: window === global
global.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
global.confirm = () => true;
global.setInterval = () => 0;
global.addEventListener = () => {}; // silence the UI's own error listeners

try {
  eval(SRC);
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  process.exit(1);
}

const tabs = ['overview', 'generate', 'review', 'library', 'publish', 'analytics', 'settings'];
(async () => {
  let failed = 0;
  for (const t of tabs) {
    try {
      await new Promise((resolve) => {
        window.switchTab(t);
        setTimeout(resolve, 1500);
      });
      console.log(`  ✓ ${t} renders`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${t}: ${e.message}`);
    }
  }
  console.log(failed ? `\n${failed} view(s) FAILED\n` : '\nall views render without errors\n');
  process.exit(failed ? 1 : 0);
})();
