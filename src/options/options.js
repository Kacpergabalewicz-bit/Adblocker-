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
const sourceListCount = document.getElementById('sourceListCount');
const importTextarea = document.getElementById('importTextarea');
const importFileInput = document.getElementById('importFileInput');
const importTextButton = document.getElementById('importTextButton');
const sourceForm = document.getElementById('sourceForm');
const sourceInput = document.getElementById('sourceInput');
const sourceList = document.getElementById('sourceList');
const autoSyncToggle = document.getElementById('autoSyncToggle');
const syncNowButton = document.getElementById('syncNowButton');
const lastSyncText = document.getElementById('lastSyncText');
const topSitesList = document.getElementById('topSitesList');

let blockDomains = [];
let allowlistedDomains = [];
let sourceUrls = [];
let topSites = [];

init();

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'get-state' });
  blockDomains = [...(state.customDomains || [])];
  allowlistedDomains = [...(state.allowlistedDomains || [])];
  sourceUrls = [...(state.sourceUrls || [])];
  topSites = [...(state.topSites || [])];
  cosmeticToggle.checked = Boolean(state.cosmeticFiltering);
  autoSyncToggle.checked = Boolean(state.autoUpdateSources);
  setLastSyncText(state.lastSourceSyncAt);
  renderStats(state);
  renderDomains();
  renderSources();
  renderTopSites();
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
  topSites = [...(state.topSites || [])];
  renderStats(state);
  renderTopSites();
  setFeedback('Wyzerowano licznik blokad.');
});

importTextButton.addEventListener('click', async () => {
  const text = String(importTextarea.value || '').trim();
  if (!text) {
    setFeedback('Wklej najpierw domeny lub reguły do importu.');
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'import-domains-text',
    value: text
  });

  blockDomains = response.customDomains || [];
  renderStats(response);
  renderDomains();
  importTextarea.value = '';
  setFeedback('Zaimportowano domeny do listy blokowania.');
});

importFileInput.addEventListener('change', async () => {
  const [file] = importFileInput.files || [];
  if (!file) {
    return;
  }

  const text = await file.text();
  importTextarea.value = text;
  setFeedback('Plik wczytany. Kliknij „Importuj do blokad”.');
});

sourceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = String(sourceInput.value || '').trim();

  if (!/^https?:\/\//i.test(value)) {
    setFeedback('Podaj poprawny URL źródła (http/https).');
    return;
  }

  if (sourceUrls.includes(value)) {
    setFeedback('To źródło już jest dodane.');
    return;
  }

  sourceUrls.unshift(value);
  sourceUrls = sourceUrls.slice(0, 20);
  await saveSourceUrls();
  sourceInput.value = '';
  setFeedback('Dodano nowe źródło listy.');
});

autoSyncToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoUpdateSources: autoSyncToggle.checked });
  setFeedback('Zapisano ustawienie auto‑aktualizacji źródeł.');
});

syncNowButton.addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'sync-source-domains' });
  sourceUrls = state.sourceUrls || [];
  topSites = state.topSites || [];
  renderStats(state);
  renderSources();
  renderTopSites();
  setLastSyncText(state.lastSourceSyncAt);
  setFeedback('Synchronizacja źródeł zakończona.');
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

  renderDomainList({
    element: sourceList,
    domains: sourceUrls,
    emptyText: 'Brak źródeł auto‑list. Dodaj pierwszy URL.',
    description: 'To źródło będzie pobierane i aktualizowane automatycznie.',
    onRemove: async (url) => {
      sourceUrls = sourceUrls.filter((entry) => entry !== url);
      await saveSourceUrls();
      setFeedback('Usunięto źródło listy.');
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

async function saveSourceUrls() {
  const response = await chrome.runtime.sendMessage({
    type: 'save-source-urls',
    value: sourceUrls
  });

  sourceUrls = response.sourceUrls || [];
  renderStats(response);
  renderSources();
}

function renderSources() {
  renderDomainList({
    element: sourceList,
    domains: sourceUrls,
    emptyText: 'Brak źródeł auto‑list. Dodaj pierwszy URL.',
    description: 'To źródło będzie pobierane i aktualizowane automatycznie.',
    onRemove: async (url) => {
      sourceUrls = sourceUrls.filter((entry) => entry !== url);
      await saveSourceUrls();
      setFeedback('Usunięto źródło listy.');
    }
  });
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
  sourceListCount.textContent = String(state.sourceUrls?.length || 0);
  autoSyncToggle.checked = Boolean(state.autoUpdateSources);
  setLastSyncText(state.lastSourceSyncAt);
}

function renderTopSites() {
  topSitesList.innerHTML = '';

  if (!topSites.length) {
    const empty = document.createElement('li');
    empty.className = 'domain-item';
    empty.textContent = 'Brak danych. Odwiedź kilka stron i wróć tutaj.';
    topSitesList.append(empty);
    return;
  }

  for (const site of topSites.slice(0, 5)) {
    const item = document.createElement('li');
    item.className = 'domain-item';

    const host = document.createElement('strong');
    host.textContent = site.host;

    const count = document.createElement('p');
    count.textContent = `${formatCount(site.count)} blokad`;

    const info = document.createElement('div');
    info.append(host, count);
    item.append(info);
    topSitesList.append(item);
  }
}

function setLastSyncText(value) {
  if (!value) {
    lastSyncText.textContent = 'Ostatnia synchronizacja: brak';
    return;
  }

  const date = new Date(Number(value));
  lastSyncText.textContent = `Ostatnia synchronizacja: ${date.toLocaleString('pl-PL')}`;
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
