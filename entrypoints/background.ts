// Background service worker implementing RSI pledge scraping and upload to Citizen Hangar backend
export default defineBackground(() => {
  (async () => {
type LogsEntry = { ts: string; level: string; msg: string; meta: any | null };

const PROD_BASE = 'https://citizenhangar.space';
const DEV_BASE = 'http://localhost:3000';
const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const LOG_LIMIT = 500;

async function getStore<T = any>(keys: string[] | Record<string, any>) {
  const res = await browser.storage.local.get(keys as any);
  return res as T;
}

async function setStore(obj: Record<string, any>) {
  await browser.storage.local.set(obj);
}

async function removeStore(keys: string | string[]) {
  await browser.storage.local.remove(keys);
}

async function appendLog(level: string, msg: string, meta?: any) {
  try {
    const ts = new Date().toISOString();
    const entry: LogsEntry = { ts, level, msg: String(msg), meta: meta ?? null };
    const s = await getStore<{ debugEnabled?: boolean; __sctr_logs?: LogsEntry[] }>(['debugEnabled', '__sctr_logs']);
    const debugEnabled = !!s.debugEnabled;
    const logs = Array.isArray(s.__sctr_logs) ? s.__sctr_logs : [];

    if (debugEnabled) {
      if (level === 'error') console.error('[SCTR EXT]', ts, msg, meta || '');
      else if (level === 'warn') console.warn('[SCTR EXT]', ts, msg, meta || '');
      else console.log('[SCTR EXT]', ts, msg, meta || '');
    }

    logs.unshift(entry);
    if (logs.length > LOG_LIMIT) logs.length = LOG_LIMIT;
    await setStore({ __sctr_logs: logs });
  } catch (err) {
    try { console.warn('appendLog failed', err); } catch (_) {}
  }
}

const debugLog = (m: string, meta?: any) => appendLog('debug', m, meta);
const warnLog = (m: string, meta?: any) => appendLog('warn', m, meta);
const errorLog = (m: string, meta?: any) => appendLog('error', m, meta);

async function getSettings() {
  const s = await getStore<{ devMode?: boolean; debugEnabled?: boolean }>(['devMode', 'debugEnabled']);
  return { devMode: !!s.devMode, debugEnabled: !!s.debugEnabled };
}

async function getBaseUrl() {
  const { devMode } = await getSettings();
  return devMode ? DEV_BASE : PROD_BASE;
}

async function postToServer(path: string, body: any, options: { baseUrl?: string } = {}) {
  try {
    const base = options.baseUrl || (await getBaseUrl());
    const url = base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
    await debugLog('postToServer: attempt', { url, body });

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    }).catch((err) => ({ networkError: true, err } as any));

    if (!resp) {
      await warnLog('postToServer: no response object', { path, body });
      return { ok: false, error: 'no_response' };
    }
    if ((resp as any).networkError) {
      return { ok: false, error: 'network_error', detail: (resp as any).err?.message };
    }

    const status = (resp as Response).status;
    let json: any = null;
    try {
      json = await (resp as Response).json();
    } catch (parseErr) {
      const text = await (resp as Response).text().catch(() => null);
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
    await errorLog('postToServer: unexpected error', { err: err && (err as Error).message });
    return { ok: false, error: 'internal_error', detail: err && (err as Error).message };
  }
}

async function fetchPledgesPage(page: number) {
  const url = `https://robertsspaceindustries.com/account/pledges?page=${page}`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`RSI fetch failed status ${r.status}`);
  return await r.text();
}

async function collectPledgePages(maxPages = 250) {
  const pages: string[] = [];
  try {
    const firstHtml = await fetchPledgesPage(1);
    pages.push(firstHtml);

    const matches = Array.from(firstHtml.matchAll(/[?&]page=(\d+)/g)).map((m) => parseInt(m[1], 10)).filter(Boolean);
    let last = matches.length ? Math.max(...matches) : null;
    if (!last) last = maxPages;
    last = Math.min(last, 250);

    for (let p = 2; p <= last; p += 1) {
      try {
        const html = await fetchPledgesPage(p);
        if (!/pledge/i.test(html)) break;
        pages.push(html);
      } catch (err) {
        await warnLog('collectPledgePages: fetch error', { page: p, err: err && (err as Error).message });
        break;
      }
    }
  } catch (err) {
    await warnLog('collectPledgePages: initial fetch error', { err: err && (err as Error).message });
  }
  return pages;
}

async function doSync(options: { bypassCooldown?: boolean; baseUrl?: string } = { bypassCooldown: false }) {
  const s = await getStore<{ eat?: string; lastSync?: number }>(['eat', 'lastSync']);
  const eat = s.eat;
  if (!eat) {
    await warnLog('doSync aborted: not paired');
    return { ok: false, error: 'not_paired' };
  }

  const now = Date.now();
  if (!options.bypassCooldown && s.lastSync && now - s.lastSync < SYNC_COOLDOWN_MS) {
    await debugLog('doSync: cooldown active');
    return { ok: false, error: 'cooldown' };
  }

  const pages = await collectPledgePages();
  await debugLog('doSync: collected pages', { count: pages.length });

  const resp = await postToServer('/api/extension/pledges', { eat, rawHtmlPages: pages }, { baseUrl: options.baseUrl });

  if (resp && (resp as any).ok) {
    await setStore({ lastSync: Date.now() });
    await debugLog('doSync: server accepted', { count: pages.length });
    return { ok: true };
  }

  await warnLog('doSync: server rejected', { resp });
  return { ok: false, error: (resp && (resp as any).error) || 'server_reject' };
}

try {
  browser.alarms?.create && browser.alarms.create('hourlySync', { periodInMinutes: 60 });
} catch (err) {
  await warnLog('alarms.create error', { err: err && (err as Error).message });
}

browser.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm && alarm.name === 'hourlySync') {
    await debugLog('alarm fired: hourlySync');
    await doSync({ bypassCooldown: true }).catch(() => {});
  }
});

// Normalize incoming messages (support both `type` from the popup and `action` from older handlers)
browser.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  // Use callback-style sendResponse and return true so the port stays open
  void debugLog('onMessage received (callback)', { msg });

  (async () => {
    try {
      const action = msg?.action || msg?.type;
      if (!action) {
        await warnLog('onMessage: invalid message (no action/type)', { msg });
        sendResponse({ ok: false, error: 'invalid_message' });
        return;
      }

      if (action === 'createPair' || action === 'create-pair') {
        await debugLog('createPair requested');
        const url = (await getBaseUrl()).replace(/\/$/, '') + '/extension/api/create-pair';
        try {
          const resp = await fetch(url, { method: 'POST', credentials: 'include' });
          const body = await resp.json().catch(() => null);
          await debugLog('createPair result', { status: resp.status, body });
          sendResponse({ status: resp.status, body });
          return;
        } catch (err) {
          await errorLog('createPair error', { err: (err as any)?.message });
          sendResponse({ ok: false, error: 'network_error', detail: (err as any)?.message });
          return;
        }
      }

      if (action === 'exchangeCode' || action === 'pair') {
        const code = msg.code || (msg.payload && msg.payload.code);
        if (!code || typeof code !== 'string') {
          await warnLog('pair: missing code');
          sendResponse({ ok: false, error: 'missing_code' });
          return;
        }
        const baseOverride = typeof msg.baseUrl === 'string' ? msg.baseUrl : undefined;
        if (typeof msg.devMode === 'boolean') await setStore({ devMode: !!msg.devMode });
        await debugLog('pair: attempting', { code });
        const payload = { code: String(code) };
        const resp = await postToServer('/api/extension/pair', payload, { baseUrl: baseOverride });
        if (resp && (resp as any).eat) {
          await setStore({ eat: (resp as any).eat });
          await debugLog('pair: EAT received and stored');
          const syncRes = await doSync({ bypassCooldown: true, baseUrl: baseOverride });
          await debugLog('pair: initial sync result', { syncRes });
          sendResponse({ ok: true });
          return;
        }
        await warnLog('pair failed', { resp });
        sendResponse({ ok: false, error: 'pair_failed', detail: resp });
        return;
      }

      if (action === 'triggerSync' || action === 'manual-sync' || action === 'initial-sync') {
        await debugLog('manual sync requested', { bypassCooldown: true });
        const res = await doSync({ bypassCooldown: true });
        await debugLog('manual sync result', { res });
        sendResponse(res);
        return;
      }

      if (action === 'getStatus' || action === 'get-status') {
        await debugLog('getStatus requested');
        const items = await getStore(['eat', 'lastSync', 'devMode', 'debugEnabled', '__sctr_logs']);
        sendResponse(items);
        return;
      }

      if (action === 'set-settings') {
        await debugLog('set-settings', { msg });
        const updates: Record<string, any> = {};
        if (typeof msg.devMode !== 'undefined') updates.devMode = !!msg.devMode;
        if (typeof msg.debugEnabled !== 'undefined') updates.debugEnabled = !!msg.debugEnabled;
        await setStore(updates);
        await debugLog('set-settings saved', updates);
        sendResponse({ ok: true });
        return;
      }

      if (action === 'revoke') {
        await removeStore(['eat', 'lastSync']);
        await debugLog('revoke: cleared extension auth');
        sendResponse({ ok: true });
        return;
      }

      if (action === 'clear-logs') {
        await setStore({ __sctr_logs: [] });
        await debugLog('clear-logs');
        sendResponse({ ok: true });
        return;
      }

      await warnLog('Unknown action', { action, msg });
      sendResponse({ ok: false, error: 'unknown_action' });
    } catch (err) {
      await errorLog('onMessage handler error', { err: err && (err as Error).message, msg });
      sendResponse({ ok: false, error: 'internal_error', detail: err && (err as Error).message });
    }
  })();

  return true; // keep message channel open for async response
});

    await debugLog('background initialized', { prod: PROD_BASE, local: DEV_BASE });
  })();

});
