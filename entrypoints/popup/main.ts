import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

function createEl<T extends HTMLElement = HTMLElement>(tag: string, props?: Record<string, any>) {
  const el = document.createElement(tag) as T;
  if (props) Object.assign(el, props);
  return el;
}

app.innerHTML = '';

const title = createEl('h1');
title.textContent = 'SCTR Extension';
app.appendChild(title);

const status = createEl<HTMLDivElement>('div');
status.id = 'status';
status.textContent = 'Loading...';
app.appendChild(status);

const card = createEl<HTMLDivElement>('div');
card.className = 'card';

const createPairBtn = createEl<HTMLButtonElement>('button');
createPairBtn.textContent = 'Create Pair Code';
card.appendChild(createPairBtn);

const codeInput = createEl<HTMLInputElement>('input');
codeInput.placeholder = 'Enter 6-digit code';
codeInput.style.marginLeft = '8px';
card.appendChild(codeInput);

const exchangeBtn = createEl<HTMLButtonElement>('button');
exchangeBtn.textContent = 'Exchange Code';
exchangeBtn.style.marginLeft = '8px';
card.appendChild(exchangeBtn);

const syncBtn = createEl<HTMLButtonElement>('button');
syncBtn.textContent = 'Trigger Sync Now';
syncBtn.style.display = 'block';
syncBtn.style.marginTop = '12px';
card.appendChild(syncBtn);

const devToggle = createEl<HTMLButtonElement>('button');
devToggle.textContent = 'Toggle Dev Mode';
devToggle.style.marginTop = '8px';
card.appendChild(devToggle);

const logsBtn = createEl<HTMLButtonElement>('button');
logsBtn.textContent = 'Open Logs';
logsBtn.style.marginTop = '8px';
card.appendChild(logsBtn);

app.appendChild(card);

async function refreshStatus() {
  const res = await browser.runtime.sendMessage({ type: 'getStatus' });
  status.textContent = `Paired: ${!!res?.eat} — Dev: ${res?.dev ? 'ON' : 'OFF'} — Last sync: ${res?.lastSync ? new Date(res.lastSync).toLocaleString() : 'never'}`;
}

createPairBtn.onclick = async () => {
  createPairBtn.disabled = true;
  await browser.runtime.sendMessage({ type: 'createPair' });
  await refreshStatus();
  createPairBtn.disabled = false;
};

exchangeBtn.onclick = async () => {
  const code = codeInput.value.trim();
  if (!code) return alert('Enter code');
  exchangeBtn.disabled = true;
  const res = await browser.runtime.sendMessage({ type: 'exchangeCode', code });
  await refreshStatus();
  exchangeBtn.disabled = false;
  if (res?.status && res.status >= 400) alert('Pair failed');
};

syncBtn.onclick = async () => {
  syncBtn.disabled = true;
  await browser.runtime.sendMessage({ type: 'triggerSync' });
  await refreshStatus();
  syncBtn.disabled = false;
};

devToggle.onclick = async () => {
  await browser.runtime.sendMessage({ type: 'toggleDev' });
  await refreshStatus();
};

logsBtn.onclick = async () => {
  const res = await browser.runtime.sendMessage({ type: 'getStatus' });
  const logs = res?.logs || [];
  const w = window.open('', '_blank', 'width=600,height=600');
  if (!w) return;
  w.document.title = 'SCTR Logs';
  const pre = w.document.createElement('pre');
  pre.textContent = logs.join('\n');
  w.document.body.appendChild(pre);
};

refreshStatus();
