export default defineContentScript({
  matches: ['https://citizenhangar.space/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  main() {
    const runtime = typeof browser !== 'undefined' ? browser.runtime : (window as any).chrome?.runtime;
    const CHANNEL_NAMES = ['CITIZEN_HANGAR_EXTENSION', 'SCTR_EXTENSION'];
    const READY_EVENTS = ['citizen-hangar-extension-ready', 'sctr-extension-ready'];
    const allowedOriginPatterns = [
      /^https?:\/\/localhost(?::\d+)?$/i,
      /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
      /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/i,
      /^https?:\/\/([a-z0-9-]+\.)?(citizenhangar|sctr|starhoppers)\.space$/i,
    ];

    const isAllowedOrigin = (origin = '') => allowedOriginPatterns.some((pattern) => pattern.test(origin));

    function sendRuntimeMessage(payload: any) {
      // If the `browser` namespace exists (Promise-based), use it directly.
      if (typeof (window as any).browser !== 'undefined') {
        try {
          console.debug('content: sending message via browser.runtime', payload);
          return (window as any).browser.runtime.sendMessage(payload);
        } catch (err) {
          console.warn('content: browser.runtime.sendMessage threw', err);
        }
      }

      // Fallback for chrome.* which uses callbacks — wrap in a Promise.
      return new Promise((resolve) => {
        try {
          console.debug('content: sending message via chrome.runtime (callback)', payload);
          (window as any).chrome.runtime.sendMessage(payload, (response: any) => {
            const err = (window as any).chrome && (window as any).chrome.runtime && (window as any).chrome.runtime.lastError;
            if (err) resolve({ ok: false, error: (err as any).message || 'runtime_error' });
            else resolve(response);
          });
        } catch (err) {
          resolve({ ok: false, error: (err as any) && (err as any).message ? (err as any).message : 'runtime_error' });
        }
      });
    }

    function reply(origin: string, payload: any, channel = CHANNEL_NAMES[0]) {
      try {
        window.postMessage({ source: channel, ...payload }, origin);
      } catch (_) {
        // ignore
      }
    }

    const pageOrigin = window.location.origin;
    let readyAnnounced = false;
    const activeRequests = new Set<string>();

    function announceReady() {
      if (readyAnnounced) return;
      if (!isAllowedOrigin(pageOrigin)) return;
      readyAnnounced = true;
      CHANNEL_NAMES.forEach((channel) => reply(pageOrigin, { type: 'READY' }, channel));
      READY_EVENTS.forEach((eventName) => {
        try {
          window.dispatchEvent(new CustomEvent(eventName, { detail: { origin: pageOrigin } }));
        } catch (_) {}
      });
    }

    announceReady();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announceReady);

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!isAllowedOrigin(event.origin)) return;
      const { data } = event as any;
      if (!data || !CHANNEL_NAMES.includes(data.target)) return;

      const { requestId } = data;
      const channel = data.target;

      if (data.type === 'PING') {
        reply(event.origin, { type: 'PONG', requestId }, channel);
        return;
      }

      if (requestId && activeRequests.has(requestId)) return;
      if (requestId) activeRequests.add(requestId);

      const finalizeRequest = () => { if (requestId) activeRequests.delete(requestId); };

      if (data.type === 'PAIR' && data.payload && data.payload.code) {
        sendRuntimeMessage({ action: 'pair', code: data.payload.code, baseUrl: data.payload.baseUrl, devMode: data.payload.devMode })
          .then((response: any) => reply(event.origin, { type: 'PAIR_RESULT', requestId, response }, channel))
          .catch((error: any) => reply(event.origin, { type: 'PAIR_RESULT', requestId, response: { ok: false, error: error && error.message ? error.message : 'runtime_error' } }, channel))
          .finally(finalizeRequest);
        return;
      }

      if (data.type === 'REVOKE') {
        sendRuntimeMessage({ action: 'revoke' })
          .then((response: any) => reply(event.origin, { type: 'REVOKE_RESULT', requestId, response }, channel))
          .catch((error: any) => reply(event.origin, { type: 'REVOKE_RESULT', requestId, response: { ok: false, error: error && error.message ? error.message : 'runtime_error' } }, channel))
          .finally(finalizeRequest);
      }
    });

    console.log('SCTR content script active');
  },
});
