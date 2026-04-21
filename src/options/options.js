const blockForm = document.getElementById('blockForm');
const blockInput = document.getElementById('blockInput');
const blockList = document.getElementById('blockList');
const allowForm = document.getElementById('allowForm');
const allowInput = document.getElementById('allowInput');
const allowList = document.getElementById('allowList');
const feedback = document.getElementById('feedback');
const cosmeticToggle = document.getElementById('cosmeticToggle');
const resetStatsButton = document.getElementById('resetStatsButton');
const totalBlockedValue = document.getElementById('totalBlockedValue');
const blockedListCount = document.getElementById('blockedListCount');
const allowlistListCount = document.getElementById('allowlistListCount');

let blockDomains = [];
let allowlistedDomains = [];

init();

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'get-state' });
  blockDomains = [...(state.customDomains || [])];
  allowlistedDomains = [...(state.allowlistedDomains || [])];
  cosmeticToggle.checked = Boolean(state.cosmeticFiltering);
  renderStats(state);
  renderDomains();
}

blockForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const value = sanitizeDomain(blockInput.value);
  if (!value) {
    setFeedback('Podaj poprawną domenę, np. ads.example.com');
    return;
  }

  if (blockDomains.includes(value)) {
    setFeedback('Ta domena już jest na liście.');
    return;
  }

  blockDomains.unshift(value);
  blockDomains = blockDomains.slice(0, 500);
  await saveBlockDomains();
  blockInput.value = '';
  setFeedback('Dodano domenę do blokowania.');
});

allowForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const value = sanitizeDomain(allowInput.value);
  if (!value) {
    setFeedback('Podaj poprawną domenę do białej listy, np. example.com');
    return;
  }

  if (allowlistedDomains.includes(value)) {
    setFeedback('Ta domena już jest na białej liście.');
    return;
  }

  allowlistedDomains.unshift(value);
  allowlistedDomains = allowlistedDomains.slice(0, 500);
  await saveAllowlistedDomains();
  allowInput.value = '';
  setFeedback('Dodano domenę do białej listy.');
});

cosmeticToggle.addEventListener('change', async () => {
  const state = await chrome.runtime.sendMessage({
    type: 'set-cosmetic-filtering',
    value: cosmeticToggle.checked
  });

  renderStats(state);
  setFeedback('Zapisano ustawienie kosmetycznego filtrowania.');
});

resetStatsButton.addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'reset-stats' });
  renderStats(state);
  setFeedback('Wyzerowano licznik blokad.');
});

function renderDomains() {
  renderDomainList({
    element: blockList,
    domains: blockDomains,
    emptyText: 'Brak własnych domen. Korzystasz tylko z domyślnych filtrów.',
    description: 'Ta domena zostanie blokowana dodatkowo.',
    onRemove: async (domain) => {
      blockDomains = blockDomains.filter((entry) => entry !== domain);
      await saveBlockDomains();
      setFeedback('Usunięto domenę z listy blokowania.');
    }
  });

  renderDomainList({
    element: allowList,
    domains: allowlistedDomains,
    emptyText: 'Brak domen na białej liście.',
    description: 'Blokowanie będzie pomijane dla tej domeny.',
    onRemove: async (domain) => {
      allowlistedDomains = allowlistedDomains.filter((entry) => entry !== domain);
      await saveAllowlistedDomains();
      setFeedback('Usunięto domenę z białej listy.');
    }
  });
}

async function saveBlockDomains() {
  const response = await chrome.runtime.sendMessage({
    type: 'save-custom-domains',
    value: blockDomains
  });

  blockDomains = response.customDomains || [];
  renderStats(response);
  renderDomains();
}

async function saveAllowlistedDomains() {
  const response = await chrome.runtime.sendMessage({
    type: 'save-allowlisted-domains',
    value: allowlistedDomains
  });

  allowlistedDomains = response.allowlistedDomains || [];
  renderStats(response);
  renderDomains();
}

function renderDomainList({ element, domains, emptyText, description, onRemove }) {
  element.innerHTML = '';

  if (!domains.length) {
    const empty = document.createElement('li');
    empty.className = 'domain-item';
    empty.textContent = emptyText;
    element.append(empty);
    return;
  }

  for (const domain of domains) {
    const item = document.createElement('li');
    item.className = 'domain-item';

    const info = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = domain;

    const desc = document.createElement('p');
    desc.textContent = description;
    info.append(label, desc);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Usuń';
    removeButton.addEventListener('click', async () => {
      await onRemove(domain);
    });

    item.append(info, removeButton);
    element.append(item);
  }
}

function renderStats(state) {
  totalBlockedValue.textContent = formatCount(state.totalBlocked);
  blockedListCount.textContent = String(state.customDomains?.length || 0);
  allowlistListCount.textContent = String(state.allowlistedDomains?.length || 0);
}

function setFeedback(message) {
  feedback.textContent = message;
}

function formatCount(value) {
  return new Intl.NumberFormat('pl-PL').format(Number(value || 0));
}

function sanitizeDomain(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .match(/^[a-z0-9.-]+\.[a-z]{2,}$/i)?.[0] || '';
}
