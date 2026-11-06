// The app's own words in English or Lithuanian. English is written in app.js and is also the key, so a string
// with no translation yet simply shows in English. The language belongs to this PC, like dark mode, and changing
// it reloads the page, so even text built when the page loads comes out in the new language.
(function () {
  const KEY = 'etiketas.uiLanguage';
  let lang = 'en';
  try { if (localStorage.getItem(KEY) === 'lt') lang = 'lt'; } catch { /* storage unavailable: stays English */ }
  document.documentElement.lang = lang;

  const LT = window.I18N_LT || {};
  const missing = new Set();          // for checking a translation: what was asked for and had none

  const fill = (text, args) => args.length ? text.replace(/\{(\d+)\}/g, (m, i) => { const v = args[+i]; return v == null ? '' : v; }) : text;
  // Keys are looked up without the spaces around them: a piece of a sentence keeps the ones it came with.
  const lookup = key => {
    if (lang === 'en') return key;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(key);
    const hit = LT[m[2]];
    if (hit == null) { if (m[2]) missing.add(m[2]); return key; }
    return m[1] + hit + m[3];
  };
  // Lithuanian has three forms: 1, 21 "failas"; 2, 22 "failai"; 0, 10-20, 30 "failų".
  const ltForm = n => {
    const a = Math.abs(n), t = a % 10, h = a % 100;
    if (!Number.isInteger(a)) return 1;
    if (t === 1 && h !== 11) return 0;
    if (t >= 2 && h >= 11 && h <= 19) return 2;
    return t >= 2 ? 1 : 2;
  };

  window.tx = (text, ...args) => fill(lookup(text), args);
  // The same for a sentence with elements inside it: what comes back can be rendered, in the sentence's order.
  window.txj = (text, ...nodes) => {
    const parts = lookup(text).split(/\{(\d+)\}/);
    return React.createElement(React.Fragment, null, ...parts.map((p, i) => i % 2 ? nodes[+p] : p));
  };
  // A sentence with a count: {0} is the count, {1} and on are the rest.
  window.txn = (n, one, other, ...args) => {
    const all = [n, ...args];
    if (lang === 'en') return fill(n === 1 ? one : other, all);
    const key = `${one}|${other}`, hit = LT[key];
    if (hit == null) { missing.add(key); return fill(n === 1 ? one : other, all); }
    return fill(Array.isArray(hit) ? hit[ltForm(n)] : hit, all);
  };

  // Messages the server sends are English sentences, some with a name or path in them.
  const SERVER = [
    [/^(\d+)-language layout matches$/, '{0}-language layout matches'],
    [/^Layout: (.+) vs (.+) langs$/, 'Layout: {0} vs {1} langs'],
    [/^Product: (.+)$/, 'Product: {0}'],
    [/^Qty matches: (.+)$/, 'Qty matches: {0}'],
    [/^Qty: (.+)$/, 'Qty: {0}'],
    [/^Size: (.+)$/, 'Size: {0}'],
    [/^Category: (.+)$/, 'Category: {0}'],
    [/^File already exists: (.+)$/, 'File already exists: {0}'],
    [/^File not found: (.+)$/, 'File not found: {0}'],
    [/^Folder not found: (.+)$/, 'Folder not found: {0}'],
    [/^Product not found: (.+)$/, 'Product not found: {0}'],
    [/^No dimensions for (.+)$/, 'No dimensions for {0}'],
    [/^Could not read (.+) or (.+)$/, 'Could not read {0} or {1}'],
    [/^(.+) is already on the SKU list$/, '{0} is already on the SKU list'],
    [/^There is no mockup picture for (.+) yet\.$/, 'There is no mockup picture for {0} yet.'],
  ];
  window.txs = message => {
    if (!message || lang === 'en') return message;
    for (const [re, key] of SERVER) {
      const m = re.exec(message);
      if (m) return fill(lookup(key), m.slice(1));
    }
    return lookup(message);
  };

  window.UI_LANG = lang;
  window.UI_LOCALE = lang === 'lt' ? 'lt-LT' : 'en-US';
  window.I18N_MISSING = missing;
  window.setUiLanguage = next => {
    try { localStorage.setItem(KEY, next); } catch { /* stays as it is */ }
    location.reload();
  };
})();
