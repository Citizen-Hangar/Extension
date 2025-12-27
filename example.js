// MV3 service worker background (based on chrome/background.js)
(async function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;

  const PROD_BASE = 'https://citizenhangar.space';
  const LOCAL_BASE = 'http://localhost:3000';
  const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
  const LOG_LIMIT = 300;

  function getStorage(keys) {
    return new Promise((resolve) => {
      api.storage.local.get(keys, (items) => resolve(items || {}));
    });
  }

  function setStorage(obj) {
    return new Promise((resolve) => {
      api.storage.local.set(obj, () => resolve());
    });
  }

  function removeStorage(keys) {
    return new Promise((resolve) => {
      api.storage.local.remove(keys, () => resolve());
    });
  }

  async function appendLog(level, msg, meta) {
    try {
      const ts = new Date().toISOString();
      const entry = { ts, level, msg: String(msg), meta: meta || null };
      const storage = await getStorage(['debugEnabled', '__sctr_logs']);
      const debugEnabled = !!storage.debugEnabled;
      const logs = Array.isArray(storage.__sctr_logs) ? storage.__sctr_logs : [];

      if (debugEnabled) {
        const prefix = `[CH EXT] ${ts} ${msg}`;
        if (level === 'error') console.error(prefix, meta || '');
        else if (level === 'warn') console.warn(prefix, meta || '');
        else console.log(prefix, meta || '');
      }

      logs.unshift(entry);
      if (logs.length > LOG_LIMIT) logs.length = LOG_LIMIT;
      await setStorage({ __sctr_logs: logs });
    } catch (err) {
      try { console.warn('appendLog failed', err && err.message); } catch (_) {}
    }
  }

  const debugLog = (msg, meta) => appendLog('debug', msg, meta);
  const warnLog = (msg, meta) => appendLog('warn', msg, meta);
  const errorLog = (msg, meta) => appendLog('error', msg, meta);

  async function getSettings() {
    const storage = await getStorage(['devMode', 'debugEnabled']);
    return {
      devMode: !!storage.devMode,
      debugEnabled: !!storage.debugEnabled,
    };
  }

  async function getBaseUrl() {
    const { devMode } = await getSettings();
    return devMode ? LOCAL_BASE : PROD_BASE;
  }

  async function postToServer(path, body, options = {}) {
    try {
      const base = options.baseUrl ? options.baseUrl : await getBaseUrl();
      const url = base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);

      await debugLog('postToServer: attempt', { url, body });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      }).catch((err) => ({ networkError: true, err }));

      if (!response) {
        await warnLog('postToServer: no response object', { path, body });
        return { ok: false, error: 'no_response' };
      }

      if (response.networkError) {
        return { ok: false, error: 'network_error', detail: response.err && response.err.message };
      }

      const status = response.status;
      let json = null;
      try {
        json = await response.json();
      } catch (parseErr) {
        const text = await response.text().catch(() => null);
        await warnLog('postToServer: response parse error', { url, status, text });
        return { ok: false, error: 'parse_error', status, raw: text };
      }

      if (status >= 200 && status < 300) {
        await debugLog('postToServer: success', { url, status, json });
        return json;
      }

      await warnLog('postToServer: HTTP error', { url, status, json });
      return { ok: false, error: 'http_error', status, json };
    } catch (err) {
      await errorLog('postToServer: unexpected error', { err: err && err.message });
      return { ok: false, error: 'internal_error', detail: err && err.message };
    }
  }

  async function fetchPledgesPage(page) {
    const url = `https://robertsspaceindustries.com/account/pledges?page=${page}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`RSI fetch failed status ${res.status}`);
    return res.text();
  }

  async function collectPledgePages(maxPages = 250) {
    const pages = [];
    try {
      const firstHtml = await fetchPledgesPage(1);
      pages.push(firstHtml);

      // Attempt to discover last page from pagination links like ?page=2
      const matches = Array.from(firstHtml.matchAll(/[?&]page=(\d+)/g)).map(m => parseInt(m[1], 10)).filter(Boolean);
      let last = matches.length ? Math.max(...matches) : null;

      // If no pagination found in first page, probe forward up to maxPages or until an empty page
      if (!last) {
        last = maxPages;
      }

      // Cap to a reasonable limit to avoid runaway loops
      last = Math.min(last, 250);

      for (let p = 2; p <= last; p += 1) {
        try {
          const html = await fetchPledgesPage(p);
          // stop if page appears empty of pledges
          if (!/pledge/i.test(html)) break;
          pages.push(html);
        } catch (err) {
          await warnLog('collectPledgePages: fetch error', { page: p, err: err && err.message });
          break;
        }
      }
    } catch (err) {
      await warnLog('collectPledgePages: initial fetch error', { err: err && err.message });
    }
    return pages;
  }

  async function doSync(options = { bypassCooldown: false }) {
    const storage = await getStorage(['eat', 'lastSync']);
    const eat = storage.eat;
    if (!eat) {
      await warnLog('doSync aborted: not paired');
      return { ok: false, error: 'not_paired' };
    }

    const now = Date.now();
    if (!options.bypassCooldown && storage.lastSync && now - storage.lastSync < SYNC_COOLDOWN_MS) {
      await debugLog('doSync: cooldown active');
      return { ok: false, error: 'cooldown' };
    }

    const pages = await collectPledgePages();
    await debugLog('doSync: collected pages', { count: pages.length });

    const resp = await postToServer(
      '/api/extension/pledges',
      { eat, rawHtmlPages: pages },
      { baseUrl: options.baseUrl }
    );

    if (resp && resp.ok) {
      await setStorage({ lastSync: Date.now() });
      await debugLog('doSync: server accepted', { count: pages.length });
      return { ok: true };
    }

    await warnLog('doSync: server rejected', { resp });
    return { ok: false, error: (resp && resp.error) || 'server_reject' };
  }

  try {
    api.alarms.create && api.alarms.create('hourlySync', { periodInMinutes: 60 });
  } catch (err) {
    await warnLog('alarms.create error', { err: err && err.message });
  }

  api.alarms && api.alarms.onAlarm && api.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm && alarm.name === 'hourlySync') {
      await debugLog('alarm fired: hourlySync');
      await doSync({ bypassCooldown: true });
    }
  });

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (!msg || !msg.action) {
          await warnLog('onMessage: invalid message', msg);
          return sendResponse({ ok: false, error: 'invalid_message' });
        }

        if (msg.action === 'pair') {
          const code = msg.code;
          if (!code || typeof code !== 'string') {
            await warnLog('pair: missing code');
            return sendResponse({ ok: false, error: 'missing_code' });
          }

          const baseOverride = typeof msg.baseUrl === 'string' ? msg.baseUrl : null;
          if (typeof msg.devMode === 'boolean') {
            await setStorage({ devMode: !!msg.devMode });
            await debugLog('pair: devMode override set', { devMode: !!msg.devMode });
          }

          await debugLog('pair: attempting', { code });
          const payload = { code: String(code) };
          const resp = await postToServer('/api/extension/pair', payload, { baseUrl: baseOverride });

          if (resp && resp.eat) {
            await setStorage({ eat: resp.eat });
            await debugLog('pair: EAT received and stored');
            const syncRes = await doSync({ bypassCooldown: true, baseUrl: baseOverride });
            await debugLog('pair: initial sync result', { syncRes });
            return sendResponse({ ok: true });
          }

          if (resp && resp.error === 'network_error') {
            return sendResponse({ ok: false, error: 'network_error', detail: resp.detail });
          }
          if (resp && resp.error === 'http_error') {
            return sendResponse({ ok: false, error: 'http_error', status: resp.status, json: resp.json });
          }
          if (resp && resp.error === 'parse_error') {
            return sendResponse({ ok: false, error: 'parse_error', raw: resp.raw });
          }
          if (resp && resp.error) {
            return sendResponse({ ok: false, error: resp.error });
          }

          return sendResponse({ ok: false, error: 'pair_failed', detail: resp });
        }

        if (msg.action === 'manual-sync') {
          const result = await doSync({ bypassCooldown: true });
          return sendResponse(result);
        }

        if (msg.action === 'initial-sync') {
          const result = await doSync({ bypassCooldown: true });
          return sendResponse(result);
        }

        if (msg.action === 'get-status') {
          const items = await getStorage(['eat', 'lastSync', 'devMode', 'debugEnabled', '__sctr_logs']);
          return sendResponse(items);
        }

        if (msg.action === 'set-settings') {
          const updates = {};
          if (typeof msg.devMode !== 'undefined') updates.devMode = !!msg.devMode;
          if (typeof msg.debugEnabled !== 'undefined') updates.debugEnabled = !!msg.debugEnabled;
          await setStorage(updates);
          await debugLog('set-settings', updates);
          return sendResponse({ ok: true });
        }

        if (msg.action === 'revoke') {
          await removeStorage(['eat', 'lastSync']);
          await debugLog('revoke: cleared extension auth');
          return sendResponse({ ok: true });
        }

        if (msg.action === 'clear-logs') {
          await setStorage({ __sctr_logs: [] });
          await debugLog('clear-logs');
          return sendResponse({ ok: true });
        }

        await warnLog('Unknown action', msg.action);
        return sendResponse({ ok: false, error: 'unknown_action' });
      } catch (err) {
        await errorLog('onMessage handler error', { err: err && err.message, action: msg && msg.action });
        return sendResponse({ ok: false, error: 'internal_error', detail: err && err.message });
      }
    })();

    return true;
  });

  await debugLog('background initialized', { prod: PROD_BASE, local: LOCAL_BASE });
})();
// background.js — Firefox MV2 compatible
(async function() { // <-- made the IIFE async
  // Use browser if available, otherwise chrome
  const api = (typeof browser !== 'undefined') ? browser : chrome;

  const PROD_BASE = "https://citizenhangar.space";
  const LOCAL_BASE = "http://localhost:3000";
  const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const LOG_LIMIT = 300;

  // --- Storage helpers ---
  function getStorage(keys) {
    return new Promise((resolve) => {
      api.storage.local.get(keys, (items) => resolve(items || {}));
    });
  }
  function setStorage(obj) {
    return new Promise((resolve) => {
      api.storage.local.set(obj, () => resolve());
    });
  }
  function removeStorage(keys) {
    return new Promise((resolve) => {
      api.storage.local.remove(keys, () => resolve());
    });
  }

  // --- Logging helpers (persisted) ---
  async function appendLog(level, msg, meta) {
    try {
      const ts = new Date().toISOString();
      const entry = { ts, level, msg: String(msg), meta: meta || null };
      const s = await getStorage(["debugEnabled", "__sctr_logs"]);
      const debugEnabled = !!s.debugEnabled;
      const logs = Array.isArray(s.__sctr_logs) ? s.__sctr_logs : [];

      // Console output when debug enabled
      if (debugEnabled) {
        if (level === "error") console.error(`[CH EXT] ${ts} ${msg}`, meta || "");
        else if (level === "warn") console.warn(`[CH EXT] ${ts} ${msg}`, meta || "");
        else console.log(`[CH EXT] ${ts} ${msg}`, meta || "");
      }

      // Maintain logs (unshift newest first)
      logs.unshift(entry);
      if (logs.length > LOG_LIMIT) logs.length = LOG_LIMIT;
      await setStorage({ __sctr_logs: logs });
    } catch (e) {
      // never throw from logger
      try { console.warn("appendLog failed", e && e.message); } catch (e2) {}
    }
  }
  const debugLog = (m, meta) => appendLog("debug", m, meta);
  const warnLog  = (m, meta) => appendLog("warn", m, meta);
  const errorLog = (m, meta) => appendLog("error", m, meta);

  // --- Settings helper ---
  async function getSettings() {
    const s = await getStorage(["devMode", "debugEnabled"]);
    return {
      devMode: !!s.devMode,
      debugEnabled: !!s.debugEnabled
    };
  }
  async function getBaseUrl() {
    const { devMode } = await getSettings();
    return devMode ? LOCAL_BASE : PROD_BASE;
  }

  // --- Network helper for POST JSON ---
  async function postToServer(path, body, opts = {}) {
    // path must start with /
    try {
      const base = (opts && opts.baseUrl) ? opts.baseUrl : await getBaseUrl();
      const url = base.replace(/\/$/, "") + (path.startsWith("/") ? path : "/" + path);

      await debugLog("postToServer: attempt", { url, body });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(body),
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        // no redirect
      }).catch((err) => {
        // network-level error
        errorLog("postToServer fetch threw", { url, err: err && err.message });
        return { networkError: true, err };
      });

      if (!res) {
        await warnLog("postToServer: no response object", { path, body });
        return { ok: false, error: "no_response" };
      }

      if (res.networkError) {
        // fetch threw, res is an object with networkError flag
        return { ok: false, error: "network_error", detail: res.err && res.err.message };
      }

      // res is real Response object
      const status = res.status;
      let json = null;
      try {
        json = await res.json();
      } catch (parseErr) {
        const text = await res.text().catch(() => null);
        await warnLog("postToServer: response parse error", { url, status, text });
        return { ok: false, error: "parse_error", status, raw: text };
      }

      if (status >= 200 && status < 300) {
        await debugLog("postToServer: success", { url, status, json });
        return json;
      } else {
        await warnLog("postToServer: HTTP error", { url, status, json });
        // return the parsed JSON (server may return { error: ... })
        return { ok: false, error: "http_error", status, json };
      }
    } catch (err) {
      await errorLog("postToServer: unexpected error", { err: err && err.message });
      return { ok: false, error: "internal_error", detail: err && err.message };
    }
  }

  // --- RSI pages collection (same as earlier) ---
  async function fetchPledgesPage(page) {
    const url = `https://robertsspaceindustries.com/account/pledges?page=${page}`;
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`RSI fetch failed status ${r.status}`);
    return await r.text();
  }
  async function collectPledgePages(maxPages = 250) {
    const pages = [];
    try {
      const firstHtml = await fetchPledgesPage(1);
      pages.push(firstHtml);

      const matches = Array.from(firstHtml.matchAll(/[?&]page=(\d+)/g)).map(m => parseInt(m[1], 10)).filter(Boolean);
      let last = matches.length ? Math.max(...matches) : null;
      if (!last) last = maxPages;
      last = Math.min(last, 250);

      for (let p = 2; p <= last; p++) {
        try {
          const html = await fetchPledgesPage(p);
          if (!/pledge/i.test(html)) break;
          pages.push(html);
        } catch (e) {
          await warnLog("collectPledgePages: fetch error", { page: p, err: e && e.message });
          break;
        }
      }
    } catch (e) {
      await warnLog("collectPledgePages: initial fetch error", { err: e && e.message });
    }
    return pages;
  }

  // --- Sync implementation ---
  async function doSync(options = { bypassCooldown: false }) {
    const baseOverride = options && options.baseUrl;
    const s = await getStorage(["eat", "lastSync"]);
    const eat = s.eat;
    if (!eat) {
      await warnLog("doSync aborted: not paired");
      return { ok: false, error: "not_paired" };
    }

    const now = Date.now();
    if (!options.bypassCooldown && s.lastSync && (now - s.lastSync) < SYNC_COOLDOWN_MS) {
      await debugLog("doSync: cooldown active");
      return { ok: false, error: "cooldown" };
    }

    const pages = await collectPledgePages();
    await debugLog("doSync: collected pages", { count: pages.length });

    // send to server with EAT and payload
    // Server expects body: { eat: "<eat>", rawHtmlPages: [...] }
  const resp = await postToServer("/api/extension/pledges", { eat, rawHtmlPages: pages }, { baseUrl: baseOverride });

    if (resp && resp.ok) {
      await setStorage({ lastSync: Date.now() });
      await debugLog("doSync: server accepted", { count: pages.length });
      return { ok: true };
    } else {
      await warnLog("doSync: server rejected", { resp });
      return { ok: false, error: (resp && resp.error) || "server_reject" };
    }
  }

  // --- Alarms ---
  try {
    api.alarms.create && api.alarms.create("hourlySync", { periodInMinutes: 60 });
  } catch (e) {
    // ignore alarm creation error
    await warnLog("alarms.create error", { err: e && e.message });
  }
  api.alarms && api.alarms.onAlarm && api.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm && alarm.name === "hourlySync") {
      await debugLog("alarm fired: hourlySync");
      await doSync({ bypassCooldown: true });
    }
  });

  // --- Message handling from popup ---
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (!msg || !msg.action) {
          await warnLog("onMessage: invalid message", msg);
          return sendResponse({ ok: false, error: "invalid_message" });
        }

        if (msg.action === "pair") {
          const code = msg.code;
          if (!code || typeof code !== "string") {
            await warnLog("pair: missing code");
            return sendResponse({ ok: false, error: "missing_code" });
          }
          const baseOverride = (msg.baseUrl && typeof msg.baseUrl === "string") ? msg.baseUrl : null;
          if (typeof msg.devMode === "boolean") {
            await setStorage({ devMode: !!msg.devMode });
            await debugLog("pair: devMode override set", { devMode: !!msg.devMode });
          }

          await debugLog("pair: attempting", { code });

          // Make sure we POST exactly {"code":"<code>"}
          const payload = { code: String(code) };
          const resp = await postToServer("/api/extension/pair", payload, { baseUrl: baseOverride });

          // resp may be { eat: "<uuid>" } OR { error: "..." } OR our standardized { ok:false, error:... }
          if (resp && resp.eat) {
            // Save EAT locally but do NOT log it
            await setStorage({ eat: resp.eat });
            await debugLog("pair: EAT received and stored");
            // Initial sync (bypass cooldown)
            const syncRes = await doSync({ bypassCooldown: true, baseUrl: baseOverride });
            await debugLog("pair: initial sync result", { syncRes });
            return sendResponse({ ok: true });
          }

          // Handle different failure modes for clearer popup message
          if (resp && resp.error === "network_error") {
            return sendResponse({ ok: false, error: "network_error", detail: resp.detail });
          }
          if (resp && resp.error === "http_error") {
            // server returned non-2xx
            return sendResponse({ ok: false, error: "http_error", status: resp.status, json: resp.json });
          }
          if (resp && resp.error === "parse_error") {
            return sendResponse({ ok: false, error: "parse_error", raw: resp.raw });
          }
          if (resp && resp.error) {
            return sendResponse({ ok: false, error: resp.error });
          }

          // Generic fallback
          return sendResponse({ ok: false, error: "pair_failed", detail: resp });
        }

        else if (msg.action === "manual-sync") {
          const r = await doSync({ bypassCooldown: false });
          return sendResponse(r);
        }

        else if (msg.action === "initial-sync") {
          const r = await doSync({ bypassCooldown: true });
          return sendResponse(r);
        }

        else if (msg.action === "get-status") {
          const items = await getStorage(["eat", "lastSync", "devMode", "debugEnabled", "__sctr_logs"]);
          return sendResponse(items);
        }

        else if (msg.action === "set-settings") {
          const { devMode, debugEnabled } = msg;
          const toSet = {};
          if (typeof devMode !== "undefined") toSet.devMode = !!devMode;
          if (typeof debugEnabled !== "undefined") toSet.debugEnabled = !!debugEnabled;
          await setStorage(toSet);
          await debugLog("set-settings", toSet);
          return sendResponse({ ok: true });
        }

        else if (msg.action === "revoke") {
          await removeStorage(["eat", "lastSync"]);
          await debugLog("revoke: cleared extension auth");
          return sendResponse({ ok: true });
        }

        else if (msg.action === "clear-logs") {
          await setStorage({ __sctr_logs: [] });
          await debugLog("clear-logs");
          return sendResponse({ ok: true });
        }

        else {
          await warnLog("Unknown action", msg.action);
          return sendResponse({ ok: false, error: "unknown_action" });
        }
      } catch (err) {
        await errorLog("onMessage handler error", { err: err && err.message, action: msg && msg.action });
        return sendResponse({ ok: false, error: "internal_error", detail: err && err.message });
      }
    })();
    // keep channel open for async sendResponse
    return true;
  });

  // startup log
  await debugLog("background initialized", { prod: PROD_BASE, local: LOCAL_BASE });

})(); // end async IIFE

