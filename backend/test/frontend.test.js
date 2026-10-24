const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function withBrowserGlobals(relativePath, values, callback) {
  const filename = path.join(projectRoot, relativePath);
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  const resolved = require.resolve(filename);
  delete require.cache[resolved];
  try {
    require(resolved);
    await callback();
  } finally {
    delete require.cache[resolved];
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

function createThemeContext({ savedTheme = null, getError, setError, metaExists = true } = {}) {
  const attributes = new Map();
  const stored = new Map();
  if (savedTheme !== null) stored.set('spendly_theme', savedTheme);
  const meta = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); }
  };
  const root = {
    style: {},
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) || null; }
  };
  const context = {
    document: {
      documentElement: root,
      querySelector(selector) {
        assert.equal(selector, 'meta[name="theme-color"]');
        return metaExists ? meta : null;
      }
    },
    window: {
      localStorage: {
        getItem(key) {
          if (getError) throw new Error('storage read unavailable');
          return stored.get(key) || null;
        },
        setItem(key, value) {
          if (setError) throw new Error('storage write unavailable');
          stored.set(key, value);
        }
      }
    }
  };
  return { ...context, attributes, stored, meta, root };
}

test('theme initialization applies a saved theme without rewriting storage', () => {
  const context = createThemeContext({ savedTheme: 'light' });
  return withBrowserGlobals('theme.js', { window: context.window, document: context.document }, () => {
    assert.equal(context.attributes.get('data-theme'), 'light');
    assert.equal(context.root.style.colorScheme, 'light');
    assert.equal(context.meta.attributes.get('content'), '#f3f5fa');
    assert.equal(context.window.SpendlyTheme.get(), 'light');
    assert.equal(context.stored.get('spendly_theme'), 'light');
  });
});

test('theme setter accepts supported themes and persists normalized values', () => {
  const context = createThemeContext();
  return withBrowserGlobals('theme.js', { window: context.window, document: context.document }, () => {
    assert.equal(context.window.SpendlyTheme.set('medium'), 'medium');
    assert.equal(context.window.SpendlyTheme.get(), 'medium');
    assert.equal(context.root.style.colorScheme, 'medium');
    assert.equal(context.meta.attributes.get('content'), '#27313b');
    assert.equal(context.stored.get('spendly_theme'), 'medium');
    context.attributes.delete('data-theme');
    assert.equal(context.window.SpendlyTheme.get(), 'dark');
    assert.equal(context.window.SpendlyTheme.set('unknown'), 'dark');
    assert.equal(context.stored.get('spendly_theme'), 'dark');
  });
});

test('theme falls back safely when storage is unavailable or the meta tag is absent', async () => {
  const readFailure = createThemeContext({ getError: true });
  await withBrowserGlobals('theme.js', { window: readFailure.window, document: readFailure.document }, () => {
    assert.equal(readFailure.attributes.get('data-theme'), 'dark');
    assert.equal(readFailure.window.SpendlyTheme.get(), 'dark');
  });

  const writeFailure = createThemeContext({ setError: true, metaExists: false });
  await withBrowserGlobals('theme.js', { window: writeFailure.window, document: writeFailure.document }, () => {
    assert.equal(writeFailure.window.SpendlyTheme.set('light'), 'light');
    assert.equal(writeFailure.attributes.get('data-theme'), 'light');
    assert.equal(writeFailure.root.style.colorScheme, 'light');
    assert.equal(writeFailure.window.SpendlyTheme.get(), 'light');
  });
});

function createServiceWorkerContext({ cached = new Map(), fetchHandler = async () => new Response('network', { status: 200 }) } = {}) {
  const listeners = new Map();
  const deletions = [];
  const addedAssets = [];
  const cachedWrites = [];
  const cache = {
    addAll: async assets => addedAssets.push(...assets),
    put: async (request, response) => cachedWrites.push({ request, response })
  };
  const context = {
    URL,
    Response,
    Request,
    console: { log() {} },
    self: {
      addEventListener(name, listener) { listeners.set(name, listener); },
      skipWaiting() {},
      clients: { claim() {} }
    },
    caches: {
      open: async () => cache,
      keys: async () => ['legacy-cache', 'spendly-v1.3.1'],
      delete: async key => { deletions.push(key); return true; },
      match: async request => cached.get(typeof request === 'string' ? request : request.url)
    },
    fetch: fetchHandler
  };
  return { ...context, listeners, deletions, addedAssets, cachedWrites };
}

async function dispatchFetch(context, request) {
  let responsePromise;
  context.listeners.get('fetch')({
    request,
    respondWith(promise) { responsePromise = promise; }
  });
  return responsePromise;
}

test('service worker installs static assets and removes only old caches on activation', async () => {
  const context = createServiceWorkerContext();
  await withBrowserGlobals('sw.js', context, async () => {
    let installPromise;
    context.listeners.get('install')({ waitUntil(promise) { installPromise = promise; } });
    await installPromise;
    assert.ok(context.addedAssets.includes('./index.html'));
    assert.ok(context.addedAssets.includes('./theme.js'));

    let activationPromise;
    context.listeners.get('activate')({ waitUntil(promise) { activationPromise = promise; } });
    await activationPromise;
    assert.deepEqual(context.deletions, ['legacy-cache']);
  });
});

test('service worker uses network-only API requests and returns an offline JSON response', async () => {
  const context = createServiceWorkerContext({
    fetchHandler: async () => { throw new Error('offline'); }
  });
  await withBrowserGlobals('sw.js', context, async () => {
    const response = await dispatchFetch(context, new Request('https://spendly.example/api/me'));

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, error: 'Offline. Server is unreachable.' });
    assert.equal(context.cachedWrites.length, 0);
  });
});

test('service worker returns cached assets before trying the network', async () => {
  const cachedResponse = new Response('cached');
  const cached = new Map([['https://spendly.example/app.js', cachedResponse]]);
  let fetched = false;
  const context = createServiceWorkerContext({
    cached,
    fetchHandler: async () => { fetched = true; return new Response('network'); }
  });

  await withBrowserGlobals('sw.js', context, async () => {
    const response = await dispatchFetch(context, new Request('https://spendly.example/app.js'));
    assert.equal(await response.text(), 'cached');
    assert.equal(fetched, false);
  });
});

test('service worker caches successful basic responses and ignores non-cacheable responses', async () => {
  const context = createServiceWorkerContext({
    fetchHandler: async () => {
      const response = new Response('asset', { status: 200 });
      Object.defineProperty(response, 'type', { value: 'basic' });
      return response;
    }
  });
  await withBrowserGlobals('sw.js', context, async () => {
    const response = await dispatchFetch(context, new Request('https://spendly.example/styles.css'));

    assert.equal(await response.text(), 'asset');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.cachedWrites.length, 1);
    assert.equal(context.cachedWrites[0].request.url, 'https://spendly.example/styles.css');
  });

  const noStore = createServiceWorkerContext({
    fetchHandler: async () => new Response('redirected', { status: 302 })
  });
  await withBrowserGlobals('sw.js', noStore, async () => {
    const redirected = await dispatchFetch(noStore, new Request('https://spendly.example/redirect'));
    assert.equal(redirected.status, 302);
    assert.equal(noStore.cachedWrites.length, 0);
  });
});

test('service worker serves cached app shell for offline HTML and errors for other offline assets', async () => {
  const offlineCache = new Response('offline app shell');
  const context = createServiceWorkerContext({
    cached: new Map([['./index.html', offlineCache]]),
    fetchHandler: async () => { throw new Error('offline'); }
  });
  const htmlRequest = new Request('https://spendly.example/dashboard', {
    headers: { accept: 'text/html' }
  });

  await withBrowserGlobals('sw.js', context, async () => {
    assert.equal(await (await dispatchFetch(context, htmlRequest)).text(), 'offline app shell');

    const scriptRequest = new Request('https://spendly.example/missing.js');
    const failedResponse = await dispatchFetch(context, scriptRequest);
    assert.equal(failedResponse.type, 'error');
  });
});
