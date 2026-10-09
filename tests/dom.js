/**
 * A DOM small enough to boot the real app in Node, and real enough to click.
 *
 * The project has no dependencies on purpose, so there is no jsdom here. This
 * is not a browser: it keeps innerHTML as a string and finds buttons with a
 * regular expression. That is enough to drive the thing the app is actually
 * made of - a click dispatches an action, the action changes state, the state
 * is drawn as HTML - which is what the flow tests need to prove.
 *
 * What it deliberately does not do: layout, CSS, real event bubbling, or
 * selector matching beyond `[data-a]`. Anything that needs those is tested by
 * reading the source or the stylesheet instead (see plan.test.js).
 */

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.files = [];
    this.isConnected = true;
    this.scrollTop = 0;
    this.attributes = {};
    this.handlers = {};
    this.classList = {
      _set: new Set(),
      add: (...c) => c.forEach((x) => this.classList._set.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
      toggle: (c, on) => (on ? this.classList._set.add(c) : this.classList._set.delete(c)),
      contains: (c) => this.classList._set.has(c),
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
  }
  removeEventListener() {}
  dispatch(type, event = {}) {
    for (const fn of this.handlers[type] || []) fn({ target: this, ...event });
  }
  appendChild(child) {
    return child;
  }
  remove() {
    this.isConnected = false;
  }
  focus() {}
  click() {
    this.dispatch('click');
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  closest() {
    return null;
  }
  setSelectionRange() {}
  scrollIntoView() {}
  getContext() {
    return { drawImage() {} };
  }
  toDataURL() {
    return 'data:image/jpeg;base64,AAAA';
  }
}

/**
 * Install a document, localStorage and the other globals the app touches.
 * Returns handles the tests use to read the screen and click on it.
 */
export function installDom() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new El('div', id));
    return elements.get(id);
  };
  const listeners = {};

  const documentShim = {
    documentElement: new El('html'),
    head: new El('head'),
    body: Object.assign(new El('body'), {
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    }),
    getElementById: (id) => (elements.has(id) ? elements.get(id) : null),
    createElement: (tag) => new El(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
  };

  globalThis.document = documentShim;
  globalThis.window = {
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener() {},
    close() {},
    location: { href: 'https://plus.test/join?t=nimal', pathname: '/join', protocol: 'https:' },
  };
  globalThis.location = globalThis.window.location;
  globalThis.localStorage = {
    _store: new Map(),
    getItem(k) {
      return this._store.has(k) ? this._store.get(k) : null;
    },
    setItem(k, v) {
      this._store.set(k, String(v));
    },
    removeItem(k) {
      this._store.delete(k);
    },
  };
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.Image = class {
    set src(_v) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} }, vibrate: () => true },
    configurable: true,
  });

  /** Make the element the app expects to find, before it boots. */
  const seed = (...ids) => ids.forEach((id) => elements.set(id, new El('div', id)));

  /**
   * Pretend someone tapped the button carrying this action.
   *
   * The app listens on `document` and calls `event.target.closest('[data-a]')`,
   * so a synthetic target with the right dataset exercises the real path -
   * including the double-tap guard, which reads `el.dataset.busy`.
   */
  const clickers = new Map();
  async function click(action, arg) {
    const key = `${action}|${arg ?? ''}`;
    if (!clickers.has(key)) {
      const el = new El('button');
      el.dataset.a = action;
      if (arg !== undefined) el.dataset.i = String(arg);
      el.closest = (sel) => (sel === '[data-a]' || sel === '[data-a][role="button"]' ? el : null);
      el.getAttribute = () => null;
      clickers.set(key, el);
    }
    const el = clickers.get(key);
    for (const fn of listeners.click || []) {
      fn({ target: el, preventDefault() {} });
    }
    // Let the action's promises settle before the test looks at the screen.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  /** Type into a field the screen has rendered. */
  const type = (id, value) => {
    const el = get(id);
    el.value = String(value);
    for (const fn of listeners.input || []) fn({ target: el });
    el.dispatch('input');
    return el;
  };

  /** Every action the current screen offers, as "name" and "name|arg". */
  const actionsOn = (html) => {
    const found = new Set();
    for (const m of String(html).matchAll(/data-a="([^"]+)"(?:\s+data-i="([^"]*)")?/g)) {
      found.add(m[1]);
      if (m[2]) found.add(`${m[1]}|${m[2]}`);
    }
    return found;
  };

  return { El, elements, get, seed, click, type, listeners, actionsOn, document: documentShim };
}

/**
 * A fetch that answers from a table of { 'METHOD /path?query': handler }.
 * Every call is recorded, so a test can assert what the app actually sent.
 */
export function installFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });

    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, p] = pattern.split(' ');
      if (m !== method) continue;
      if (!path.startsWith(p)) continue;
      const result = typeof handler === 'function' ? await handler(body, path) : handler;
      const status = result?.__status || 200;
      const payload = result?.__status ? result.body : result;
      return {
        ok: status < 400,
        status,
        text: async () => JSON.stringify(payload ?? {}),
      };
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ error: `no route ${pattern(path)}` }) };
  };
  return calls;
}

const pattern = (p) => p;
