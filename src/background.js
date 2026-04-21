const DEFAULT_SETTINGS = {
  enabled: true,
  customDomains: [],
  allowlistedDomains: [],
  cosmeticFiltering: true,
  ytSafeModeInitialized: false,
  ytAllowlistCleanupDone: false
};

const YT_SAFE_DOMAINS = ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'];

const DEFAULT_STATS = {
  totalBlocked: 0,
  perTab: {}
};

const BLOCK_RULE_OFFSET = 100000;
const ALLOW_RULE_OFFSET = 200000;
const YT_COMPAT_DOMAINS = ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'];
const BLOCKED_RESOURCE_TYPES = [
  'script',
  'image',
  'xmlhttprequest',
  'sub_frame',
  'stylesheet',
  'media',
  'font',
  'ping',
  'other'
];
const ALLOWLIST_RESOURCE_TYPES = ['main_frame', 'sub_frame'];

chrome.runtime.onInstalled.addListener(async () => {
  await initializeExtension();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeExtension();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes.enabled) {
    await syncEnabledState();
    await syncDynamicRules();
  }

  if (changes.customDomains || changes.allowlistedDomains) {
    await syncDynamicRules();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadgeForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    await resetTabStats(tabId);
  }

  await updateBadgeForTab(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTabStats(tabId);
});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (details) => {
    const tabId = details.request?.tabId;
    await incrementBlockedStats(tabId);

    if (typeof tabId === 'number' && tabId >= 0) {
      await updateBadgeForTab(tabId);
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message || 'Unknown error' });
    });

  return true;
});

async function initializeExtension() {
  await ensureDefaults();
  await syncEnabledState();
  await syncDynamicRules();
  await updateBadgeForActiveTab();
}

async function handleMessage(message) {
  switch (message?.type) {
    case 'get-state':
      return getState(message.tabId, message.host);
    case 'set-enabled':
      await chrome.storage.local.set({ enabled: Boolean(message.value) });
      return getState(message.tabId, message.host);
    case 'save-custom-domains': {
      const domains = Array.isArray(message.value)
        ? sanitizeDomains(message.value)
        : [];
      await chrome.storage.local.set({ customDomains: domains });
      return getState(message.tabId, message.host);
    }
    case 'save-allowlisted-domains': {
      const domains = Array.isArray(message.value)
        ? sanitizeDomains(message.value)
        : [];
      await chrome.storage.local.set({ allowlistedDomains: domains });
      return getState(message.tabId, message.host);
    }
    case 'toggle-allowlisted-domain': {
      const host = sanitizeDomain(message.host);
      const settings = await getSettings();
      const nextDomains = Boolean(message.value)
        ? sanitizeDomains([...settings.allowlistedDomains, host])
        : settings.allowlistedDomains.filter((domain) => domain !== host);

      await chrome.storage.local.set({ allowlistedDomains: nextDomains });
      return getState(message.tabId, host);
    }
    case 'set-cosmetic-filtering':
      await chrome.storage.local.set({
        cosmeticFiltering: Boolean(message.value)
      });
      return getState(message.tabId, message.host);
    case 'reset-stats':
      await setStats(DEFAULT_STATS);
      await updateBadgeForActiveTab();
      return getState(message.tabId, message.host);
    default:
      return {};
  }
}

async function ensureDefaults() {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const currentAllowlisted = Array.isArray(current.allowlistedDomains)
    ? sanitizeDomains(current.allowlistedDomains)
    : DEFAULT_SETTINGS.allowlistedDomains;
  const shouldCleanupYtAllowlist = !Boolean(current.ytAllowlistCleanupDone);
  const nextAllowlistedDomains = shouldCleanupYtAllowlist
    ? currentAllowlisted.filter((domain) => !YT_SAFE_DOMAINS.includes(domain))
    : currentAllowlisted;

  await chrome.storage.local.set({
    enabled: typeof current.enabled === 'boolean' ? current.enabled : DEFAULT_SETTINGS.enabled,
    customDomains: Array.isArray(current.customDomains)
      ? sanitizeDomains(current.customDomains)
      : DEFAULT_SETTINGS.customDomains,
    allowlistedDomains: nextAllowlistedDomains,
    cosmeticFiltering:
      typeof current.cosmeticFiltering === 'boolean'
        ? current.cosmeticFiltering
        : DEFAULT_SETTINGS.cosmeticFiltering,
    ytSafeModeInitialized: true,
    ytAllowlistCleanupDone: true
  });

  const stats = await getStats();
  await setStats(stats);
}

async function getSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    enabled: Boolean(settings.enabled),
    customDomains: sanitizeDomains(settings.customDomains || []),
    allowlistedDomains: sanitizeDomains(settings.allowlistedDomains || []),
    cosmeticFiltering: Boolean(settings.cosmeticFiltering)
  };
}

async function getState(tabId, host) {
  const settings = await getSettings();
  const stats = await getStats();
  const cleanHost = sanitizeDomain(host || '');

  return {
    ...settings,
    currentSiteAllowlisted: cleanHost
      ? isHostInList(cleanHost, settings.allowlistedDomains)
      : false,
    currentTabBlocked:
      typeof tabId === 'number' && tabId >= 0
        ? Number(stats.perTab[String(tabId)] || 0)
        : 0,
    totalBlocked: Number(stats.totalBlocked || 0),
    feedbackAvailable: Boolean(chrome.declarativeNetRequest.onRuleMatchedDebug)
  };
}

async function syncEnabledState() {
  const { enabled } = await getSettings();

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? ['default'] : [],
    disableRulesetIds: enabled ? [] : ['default']
  });

  if (!enabled) {
    await chrome.action.setBadgeText({ text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
}

async function syncDynamicRules() {
  const { customDomains, allowlistedDomains, enabled } = await getSettings();
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);
  const effectiveAllowlist = sanitizeDomains([...allowlistedDomains, ...YT_COMPAT_DOMAINS]);

  const addRules = enabled
    ? [
        ...buildAllowlistRules(effectiveAllowlist),
        ...buildCustomBlockRules(customDomains)
      ]
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

function buildCustomBlockRules(domains) {
  return domains.map((domain, index) => ({
    id: BLOCK_RULE_OFFSET + index,
    priority: 10,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: BLOCKED_RESOURCE_TYPES
    }
  }));
}

function buildAllowlistRules(domains) {
  return domains.map((domain, index) => ({
    id: ALLOW_RULE_OFFSET + index,
    priority: 100,
    action: { type: 'allowAllRequests' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ALLOWLIST_RESOURCE_TYPES
    }
  }));
}

async function getStats() {
  const storageArea = getSessionStorage();
  const result = await storageArea.get({ stats: DEFAULT_STATS });
  return normalizeStats(result.stats);
}

async function setStats(stats) {
  const storageArea = getSessionStorage();
  await storageArea.set({ stats: normalizeStats(stats) });
}

async function incrementBlockedStats(tabId) {
  const stats = await getStats();
  stats.totalBlocked += 1;

  if (typeof tabId === 'number' && tabId >= 0) {
    const key = String(tabId);
    stats.perTab[key] = Number(stats.perTab[key] || 0) + 1;
  }

  await setStats(stats);
}

async function resetTabStats(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const stats = await getStats();
  stats.perTab[String(tabId)] = 0;
  await setStats(stats);
}

async function removeTabStats(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const stats = await getStats();
  delete stats.perTab[String(tabId)];
  await setStats(stats);
}

async function updateBadgeForActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    await updateBadgeForTab(activeTab.id);
  }
}

async function updateBadgeForTab(tabId) {
  const { enabled } = await getSettings();

  if (!enabled) {
    await chrome.action.setBadgeText({ tabId, text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#6b7280' });
    return;
  }

  const stats = await getStats();
  const blockedCount = Number(stats.perTab[String(tabId)] || 0);

  await chrome.action.setBadgeText({
    tabId,
    text: blockedCount > 0 ? formatBadgeCount(blockedCount) : 'ON'
  });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: blockedCount > 0 ? '#dc2626' : '#16a34a'
  });
}

function getSessionStorage() {
  return chrome.storage.session || chrome.storage.local;
}

function normalizeStats(stats) {
  return {
    totalBlocked: Number(stats?.totalBlocked || 0),
    perTab: Object.fromEntries(
      Object.entries(stats?.perTab || {}).map(([key, value]) => [key, Number(value || 0)])
    )
  };
}

function formatBadgeCount(value) {
  if (value > 999) {
    return '999+';
  }

  return String(value);
}

function isHostInList(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function sanitizeDomains(domains) {
  return [...new Set(domains.map((domain) => sanitizeDomain(domain)).filter(Boolean))].slice(0, 500);
}

function sanitizeDomain(domain) {
  return String(domain)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .match(/^[a-z0-9.-]+\.[a-z]{2,}$/i)?.[0] || '';
}
