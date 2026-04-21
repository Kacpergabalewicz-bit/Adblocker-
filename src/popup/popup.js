const statusText = document.getElementById('statusText');
const enabledToggle = document.getElementById('enabledToggle');
const allowlistToggle = document.getElementById('allowlistToggle');
const siteHost = document.getElementById('siteHost');
const allowlistHint = document.getElementById('allowlistHint');
const tabBlockedCount = document.getElementById('tabBlockedCount');
const totalBlockedCount = document.getElementById('totalBlockedCount');
const customCount = document.getElementById('customCount');
const allowlistCount = document.getElementById('allowlistCount');
const counterHint = document.getElementById('counterHint');
const openOptions = document.getElementById('openOptions');

let currentTabId = null;
let currentHost = '';

init();

async function init() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = activeTab?.id ?? null;
  currentHost = getHost(activeTab?.url);

  const response = await chrome.runtime.sendMessage({
    type: 'get-state',
    tabId: currentTabId,
    host: currentHost
  });

  renderState(response);
}

enabledToggle.addEventListener('change', async () => {
  const response = await chrome.runtime.sendMessage({
    type: 'set-enabled',
    value: enabledToggle.checked,
    tabId: currentTabId,
    host: currentHost
  });

  renderState(response);
  await reloadCurrentTab();
});

allowlistToggle.addEventListener('change', async () => {
  if (!currentHost) {
    allowlistToggle.checked = false;
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'toggle-allowlisted-domain',
    value: allowlistToggle.checked,
    host: currentHost,
    tabId: currentTabId
  });

  renderState(response);
  await reloadCurrentTab();
});

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function renderState(state) {
  enabledToggle.checked = Boolean(state.enabled);
  allowlistToggle.checked = Boolean(state.currentSiteAllowlisted);
  allowlistToggle.disabled = !currentHost;

  statusText.textContent = state.enabled ? 'Aktywne' : 'Wyłączone';
  siteHost.textContent = currentHost || 'Strona systemowa';
  tabBlockedCount.textContent = formatCount(state.currentTabBlocked);
  totalBlockedCount.textContent = formatCount(state.totalBlocked);
  customCount.textContent = String(state.customDomains?.length || 0);
  allowlistCount.textContent = String(state.allowlistedDomains?.length || 0);

  if (!currentHost) {
    allowlistHint.textContent = 'Dla stron systemowych biała lista jest niedostępna.';
  } else if (state.currentSiteAllowlisted) {
    allowlistHint.textContent = 'Ta strona jest na białej liście.';
  } else {
    allowlistHint.textContent = 'Można wyłączyć blokowanie tylko dla tej strony.';
  }

  counterHint.textContent = state.feedbackAvailable
    ? 'Po zmianie ustawienia karta odświeży się automatycznie.'
    : 'Licznik działa najlepiej w trybie deweloperskim rozszerzenia.';
}

async function reloadCurrentTab() {
  if (currentTabId) {
    await chrome.tabs.reload(currentTabId);
  }
}

function formatCount(value) {
  return new Intl.NumberFormat('pl-PL').format(Number(value || 0));
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
