(function () {
  const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
  const isBrowser = typeof browser !== 'undefined';
  const CHANNEL_NAMES = ['CITIZEN_HANGAR_EXTENSION', 'SCTR_EXTENSION'];
  const READY_EVENTS = ['citizen-hangar-extension-ready', 'sctr-extension-ready'];
  const allowedOriginPatterns = [
    /^https?:\/\/localhost(?::\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
    /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/i,
    /^https?:\/\/([a-z0-9-]+\.)?(citizenhangar|sctr|starhoppers)\.space$/i,
  ];

  const isAllowedOrigin = (origin = '') => allowedOriginPatterns.some((pattern) => pattern.test(origin));

  const sendRuntimeMessage = (payload) => {
    if (isBrowser && runtime && typeof runtime.sendMessage === 'function') {
      return runtime.sendMessage(payload);
    }
    return new Promise((resolve) => {
      try {
        runtime.sendMessage(payload, (response) => {
          const err = chrome && chrome.runtime && chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message || 'runtime_error' });
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        resolve({ ok: false, error: error && error.message ? error.message : 'runtime_error' });
      }
    });
  };

  function reply(origin, payload, channel = CHANNEL_NAMES[0]) {
    try {
      window.postMessage({ source: channel, ...payload }, origin);
    } catch (err) {
      // ignore
    }
  }

  const pageOrigin = window.location.origin;
  let readyAnnounced = false;
  const activeRequests = new Set();

  function announceReady() {
    if (readyAnnounced) return;
    if (!isAllowedOrigin(pageOrigin)) return;
    readyAnnounced = true;
    CHANNEL_NAMES.forEach((channel) => reply(pageOrigin, { type: 'READY' }, channel));
    READY_EVENTS.forEach((eventName) => {
      try {
        window.dispatchEvent(new CustomEvent(eventName, { detail: { origin: pageOrigin } }));
      } catch (err) {
        // ignore
      }
    });
  }

  announceReady();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceReady);
  }

  window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!isAllowedOrigin(event.origin)) return;
    const { data } = event;
    if (!data || !CHANNEL_NAMES.includes(data.target)) return;

    const { requestId } = data;
    const channel = data.target;

    if (data.type === 'PING') {
      reply(event.origin, { type: 'PONG', requestId }, channel);
      return;
    }

    if (requestId && activeRequests.has(requestId)) {
      return;
    }

    if (requestId) {
      activeRequests.add(requestId);
    }

    const finalizeRequest = () => {
      if (requestId) {
        activeRequests.delete(requestId);
      }
    };

    if (data.type === 'PAIR' && data.payload && data.payload.code) {
      sendRuntimeMessage({ action: 'pair', code: data.payload.code, baseUrl: data.payload.baseUrl, devMode: data.payload.devMode })
        .then((response) => reply(event.origin, { type: 'PAIR_RESULT', requestId, response }, channel))
        .catch((error) => reply(event.origin, { type: 'PAIR_RESULT', requestId, response: { ok: false, error: error && error.message ? error.message : 'runtime_error' } }, channel))
        .finally(finalizeRequest);
      return;
    }

    if (data.type === 'REVOKE') {
      sendRuntimeMessage({ action: 'revoke' })
        .then((response) => reply(event.origin, { type: 'REVOKE_RESULT', requestId, response }, channel))
        .catch((error) => reply(event.origin, { type: 'REVOKE_RESULT', requestId, response: { ok: false, error: error && error.message ? error.message : 'runtime_error' } }, channel))
        .finally(finalizeRequest);
    }
  });
})();
