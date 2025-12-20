document.addEventListener('DOMContentLoaded', () => {
  const pairBtn = document.getElementById('pairBtn');
  const syncBtn = document.getElementById('syncBtn');
  const revokeBtn = document.getElementById('revokeBtn');
  const pairCodeInput = document.getElementById('pairCode');
  const lastSyncEl = document.getElementById('lastSync');
  const statusText = document.getElementById('statusText');
  const statusChip = document.getElementById('statusChip');
  const envLabel = document.getElementById('envLabel');
  const popupShell = document.querySelector('.popup-shell');

  const envProd = document.getElementById('envProd');
  const envLocal = document.getElementById('envLocal');
  const debugToggle = document.getElementById('debugToggle');
  const showLogsBtn = document.getElementById('showLogsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const logsPre = document.getElementById('logs');

  const state = {
    paired: false,
    syncing: false,
    logsVisible: false,
  };

  const setChip = (text, variant) => {
    statusChip.textContent = text;
    statusChip.classList.remove('success', 'warning', 'danger');
    if (variant) {
      statusChip.classList.add(variant);
    }
  };

  const setStatus = (text) => {
    statusText.textContent = text;
  };

  const setLastSync = (timestamp) => {
    if (!timestamp) {
      lastSyncEl.textContent = 'Last sync: none yet';
      return;
    }
    const date = new Date(timestamp);
    lastSyncEl.textContent = `Last sync: ${date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })}`;
  };

  const applyPairState = (paired) => {
    state.paired = paired;
    popupShell?.setAttribute('data-state', paired ? 'paired' : 'unpaired');
    syncBtn.disabled = !paired;
    revokeBtn.disabled = !paired;
  };

  const setEnvLabel = (devMode) => {
    envLabel.textContent = devMode ? 'Local' : 'Prod';
  };

  const refreshStatus = () => {
    chrome.runtime.sendMessage({ action: 'get-status' }, (res) => {
      if (!res) {
        setStatus('Extension background unreachable. Try reloading the extension.');
        setChip('Unknown', 'danger');
        return;
      }

      const isPaired = !!res.eat;
      applyPairState(isPaired);
      setChip(isPaired ? 'Paired' : 'Not paired', isPaired ? 'success' : 'warning');
      setStatus(isPaired ? 'Securely paired with Citizen Hangar.' : 'Waiting for a fresh pairing code.');
      setLastSync(res.lastSync);

      const devMode = !!res.devMode;
      envLocal.checked = devMode;
      envProd.checked = !devMode;
      debugToggle.checked = !!res.debugEnabled;
      setEnvLabel(devMode);

      if (!state.logsVisible) {
        logsPre.classList.add('hidden');
      }
    });
  };

  pairBtn.addEventListener('click', () => {
    const code = pairCodeInput.value.trim();
    if (!code) {
      setStatus('Enter a 6-digit pairing code first.');
      return;
    }

    pairBtn.disabled = true;
    setStatus('Sending code to Citizen Hangar…');
    chrome.runtime.sendMessage({ action: 'pair', code }, (res) => {
      pairBtn.disabled = false;
      if (res && res.ok) {
        setStatus('Paired! Initial sync is running.');
        applyPairState(true);
        refreshStatus();
      } else {
        const reason = res && res.error ? res.error : 'unknown_error';
        setStatus(`Pair failed: ${reason}`);
        setChip('Not paired', 'danger');
      }
    });
  });

  syncBtn.addEventListener('click', () => {
    if (syncBtn.disabled) return;
    syncBtn.disabled = true;
    setStatus('Manual sync triggered…');
    chrome.runtime.sendMessage({ action: 'manual-sync' }, (res) => {
      syncBtn.disabled = false;
      if (res && res.ok) {
        setStatus('Manual sync succeeded.');
        refreshStatus();
      } else {
        setStatus(`Manual sync failed: ${(res && res.error) || 'unknown_error'}`);
        setChip('Paired (error)', 'danger');
      }
    });
  });

  revokeBtn.addEventListener('click', () => {
    if (revokeBtn.disabled) return;
    revokeBtn.disabled = true;
    setStatus('Clearing stored extension token…');
    chrome.runtime.sendMessage({ action: 'revoke' }, (res) => {
      revokeBtn.disabled = false;
      applyPairState(false);
      if (res && res.ok) {
        setStatus('Extension token cleared. Generate a new code next time.');
        setChip('Not paired', 'warning');
        setLastSync(null);
      } else {
        setStatus('Failed to clear token. You can also remove the extension to reset.');
        setChip('Not paired?', 'danger');
      }
    });
  });

  envProd.addEventListener('change', () => {
    if (!envProd.checked) return;
    chrome.runtime.sendMessage({ action: 'set-settings', devMode: false }, () => {
      setEnvLabel(false);
      refreshStatus();
    });
  });

  envLocal.addEventListener('change', () => {
    if (!envLocal.checked) return;
    chrome.runtime.sendMessage({ action: 'set-settings', devMode: true }, () => {
      setEnvLabel(true);
      refreshStatus();
    });
  });

  debugToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ action: 'set-settings', debugEnabled: !!debugToggle.checked }, () => {
      refreshStatus();
    });
  });

  showLogsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'get-status' }, (res) => {
      const logs = (res && res.__sctr_logs) || [];
      if (!logs.length) {
        logsPre.textContent = 'No logs recorded yet.';
      } else {
        logsPre.textContent = logs
          .slice(0, 200)
          .map((entry) => {
            const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
            return `[${entry.ts}] ${entry.level.toUpperCase()} ${entry.msg}${meta}`;
          })
          .join('\n');
      }
      state.logsVisible = !state.logsVisible;
      logsPre.classList.toggle('hidden', !state.logsVisible);
    });
  });

  clearLogsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear-logs' }, () => {
      state.logsVisible = false;
      logsPre.textContent = '';
      logsPre.classList.add('hidden');
      setStatus('Logs cleared.');
    });
  });

  pairCodeInput.addEventListener('input', () => {
    pairCodeInput.value = pairCodeInput.value.replace(/\s+/g, '').toUpperCase();
  });

  refreshStatus();
});
