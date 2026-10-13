// Loads and runs app.js. Its JSX is compiled in the browser by Babel; the compiled
// result is cached in localStorage under a hash of the source, so Babel (2.3 MB to
// parse, ~120 ms to compile) is only loaded when app.js has actually changed --
// editing app.js needs no build step, the next page load just recompiles it.
(async () => {
  const COMPILER = 'babel-8.0.6/react-classic';        // bump if the Babel version or its options change
  const CACHE_KEY = 'etiketas.compiled';
  const run = code => {
    const s = document.createElement('script');
    s.textContent = code;
    document.body.appendChild(s);
  };

  const source = await (await fetch('/static/app.js')).text();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(COMPILER + '\n' + source));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');

  let code = null;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.hash === hash) code = cached.code;
  } catch { /* storage unavailable or corrupt -- compile instead */ }

  if (!code) {
    await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = '/static/vendor/babel.min.js';
      s.onload = ok;
      s.onerror = () => fail(new Error('Could not load /static/vendor/babel.min.js'));
      document.head.appendChild(s);
    });
    code = Babel.transform(source, { presets: [['react', { runtime: 'classic' }]] }).code;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ hash, code })); } catch { /* over quota / private mode */ }
  }
  run(code);
})().catch(err => {
  console.error(err);
  document.getElementById('root').textContent = 'Etiketas failed to start: ' + err.message;
});
