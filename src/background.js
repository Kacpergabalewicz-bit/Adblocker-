const DEFAULT_SETTINGS = {
  enabled: true,
  customDomains: [],
  allowlistedDomains: [],
  sourceUrls: [],
  sourceDomains: [],
  autoUpdateSources: true,
  tabPausedIds: [],
  cosmeticFiltering: true,
  ytSafeModeInitialized: false,
  ytAllowlistCleanupDone: false,
  lastSourceSyncAt: 0
};

const YT_SAFE_DOMAINS = ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'];

const DEFAULT_STATS = {
  totalBlocked: 0,
  perTab: {},
  perHost: {}
};

const BLOCK_RULE_OFFSET = 100000;
const ALLOW_RULE_OFFSET = 200000;
const TAB_PAUSE_RULE_OFFSET = 400000;
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
const TAB_PAUSE_RESOURCE_TYPES = ['main_frame', ...BLOCKED_RESOURCE_TYPES];
const SOURCE_SYNC_ALARM_NAME = 'source-sync';
const SOURCE_SYNC_PERIOD_MINUTES = 180;

chrome.runtime.onInstalled.addListener(async () => {
  await initializeExtension();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeExtension();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SOURCE_SYNC_ALARM_NAME) {
    return;
  }

  const settings = await getSettings();
  if (!settings.enabled || !settings.autoUpdateSources || !settings.sourceUrls.length) {
    return;
  }

  await syncSourceDomainsFromUrls(settings.sourceUrls);
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes.enabled) {
    await syncEnabledState();
    await syncDynamicRules();
  }

  if (
    changes.customDomains ||
    changes.allowlistedDomains ||
    changes.sourceDomains ||
    changes.tabPausedIds
  ) {
    await syncDynamicRules();
  }

  if (changes.sourceUrls || changes.autoUpdateSources) {
    await syncSourceAlarm();
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
  await removePausedTab(tabId);
  await removeTabStats(tabId);
});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (details) => {
    const tabId = details.request?.tabId;
    const requestUrl = details.request?.url || '';
    await incrementBlockedStats(tabId, requestUrl);

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
  await syncSourceAlarm();
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
    case 'import-domains-text': {
      const importedDomains = parseDomainsFromText(String(message.value || ''));
      if (!importedDomains.length) {
        return getState(message.tabId, message.host);
      }

      const settings = await getSettings();
      const merged = sanitizeDomains([...settings.customDomains, ...importedDomains]).slice(0, 500);
      await chrome.storage.local.set({ customDomains: merged });
      return getState(message.tabId, message.host);
    }
    case 'save-allowlisted-domains': {
      const domains = Array.isArray(message.value)
        ? sanitizeDomains(message.value)
        : [];
      await chrome.storage.local.set({ allowlistedDomains: domains });
      return getState(message.tabId, message.host);
    }
    case 'save-source-urls': {
      const urls = Array.isArray(message.value) ? sanitizeSourceUrls(message.value) : [];
      await chrome.storage.local.set({ sourceUrls: urls });
      return getState(message.tabId, message.host);
    }
    case 'sync-source-domains': {
      const settings = await getSettings();
      await syncSourceDomainsFromUrls(settings.sourceUrls);
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
    case 'toggle-tab-pause': {
      if (typeof message.tabId !== 'number' || message.tabId < 0) {
        return getState(message.tabId, message.host);
      }

      const settings = await getSettings();
      const key = Number(message.tabId);
      const nextPausedTabs = Boolean(message.value)
        ? [...new Set([...settings.tabPausedIds, key])]
        : settings.tabPausedIds.filter((id) => id !== key);

      await chrome.storage.local.set({ tabPausedIds: nextPausedTabs });
      await notifyTabPauseChange(key, Boolean(message.value));
      return getState(message.tabId, message.host);
    }
    case 'is-tab-paused': {
      const senderTabId = _sender?.tab?.id;
      if (typeof senderTabId !== 'number') {
        return { paused: false };
      }

      const settings = await getSettings();
      return { paused: settings.tabPausedIds.includes(senderTabId) };
    }
    case 'get-top-sites': {
      return { topSites: getTopSitesFromStats(await getStats()) };
    }
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
    sourceUrls: Array.isArray(current.sourceUrls)
      ? sanitizeSourceUrls(current.sourceUrls)
      : DEFAULT_SETTINGS.sourceUrls,
    sourceDomains: Array.isArray(current.sourceDomains)
      ? sanitizeDomains(current.sourceDomains)
      : DEFAULT_SETTINGS.sourceDomains,
    autoUpdateSources:
      typeof current.autoUpdateSources === 'boolean'
        ? current.autoUpdateSources
        : DEFAULT_SETTINGS.autoUpdateSources,
    tabPausedIds: Array.isArray(current.tabPausedIds)
      ? current.tabPausedIds.filter((id) => Number.isInteger(id) && id >= 0)
      : DEFAULT_SETTINGS.tabPausedIds,
    cosmeticFiltering:
      typeof current.cosmeticFiltering === 'boolean'
        ? current.cosmeticFiltering
        : DEFAULT_SETTINGS.cosmeticFiltering,
    ytSafeModeInitialized: true,
    ytAllowlistCleanupDone: true,
    lastSourceSyncAt: Number(current.lastSourceSyncAt || 0)
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
    sourceUrls: sanitizeSourceUrls(settings.sourceUrls || []),
    sourceDomains: sanitizeDomains(settings.sourceDomains || []),
    autoUpdateSources: Boolean(settings.autoUpdateSources),
    tabPausedIds: Array.isArray(settings.tabPausedIds)
      ? settings.tabPausedIds.filter((id) => Number.isInteger(id) && id >= 0)
      : [],
    cosmeticFiltering: Boolean(settings.cosmeticFiltering),
    lastSourceSyncAt: Number(settings.lastSourceSyncAt || 0)
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
    currentTabPaused:
      typeof tabId === 'number' && tabId >= 0
        ? settings.tabPausedIds.includes(tabId)
        : false,
    currentTabBlocked:
      typeof tabId === 'number' && tabId >= 0
        ? Number(stats.perTab[String(tabId)] || 0)
        : 0,
    currentHostBlocked: cleanHost ? Number(stats.perHost[cleanHost] || 0) : 0,
    sourceUrlCount: settings.sourceUrls.length,
    sourceDomainCount: settings.sourceDomains.length,
    topSites: getTopSitesFromStats(stats),
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
  const {
    customDomains,
    sourceDomains,
    allowlistedDomains,
    enabled,
    tabPausedIds
  } = await getSettings();
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);
  const blockedDomains = sanitizeDomains([...customDomains, ...sourceDomains]).slice(0, 500);
  const effectiveAllowlist = sanitizeDomains([...allowlistedDomains, ...YT_COMPAT_DOMAINS]);

  const addRules = enabled
    ? [
        ...buildAllowlistRules(effectiveAllowlist),
        ...buildCustomBlockRules(blockedDomains)
      ]
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });

  await syncTabPauseSessionRules(tabPausedIds, enabled);
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

async function incrementBlockedStats(tabId, requestUrl) {
  const stats = await getStats();
  stats.totalBlocked += 1;

  if (typeof tabId === 'number' && tabId >= 0) {
    const key = String(tabId);
    stats.perTab[key] = Number(stats.perTab[key] || 0) + 1;
  }

  const host = extractHost(requestUrl);
  if (host) {
    stats.perHost[host] = Number(stats.perHost[host] || 0) + 1;
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

async function removePausedTab(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const settings = await getSettings();
  if (!settings.tabPausedIds.includes(tabId)) {
    return;
  }

  const nextPausedTabs = settings.tabPausedIds.filter((id) => id !== tabId);
  await chrome.storage.local.set({ tabPausedIds: nextPausedTabs });
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
    ),
    perHost: Object.fromEntries(
      Object.entries(stats?.perHost || {}).map(([key, value]) => [key, Number(value || 0)])
    )
  };
}

function getTopSitesFromStats(stats) {
  return Object.entries(stats.perHost || {})
    .sort((first, second) => second[1] - first[1])
    .slice(0, 5)
    .map(([host, count]) => ({ host, count: Number(count || 0) }));
}

async function syncTabPauseSessionRules(tabPausedIds, enabled) {
  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existingRules
    .map((rule) => rule.id)
    .filter((id) => id >= TAB_PAUSE_RULE_OFFSET && id < TAB_PAUSE_RULE_OFFSET + 100000);

  const addRules = enabled
    ? tabPausedIds.map((tabId) => ({
        id: getTabPauseRuleId(tabId),
        priority: 200,
        action: { type: 'allowAllRequests' },
        condition: {
          tabIds: [tabId],
          resourceTypes: TAB_PAUSE_RESOURCE_TYPES
        }
      }))
    : [];

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules
  });
}

function getTabPauseRuleId(tabId) {
  return TAB_PAUSE_RULE_OFFSET + Number(tabId);
}

async function notifyTabPauseChange(tabId, paused) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'tab-pause-updated', paused });
  } catch {
    return;
  }
}

async function syncSourceAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(SOURCE_SYNC_ALARM_NAME);

  if (!settings.autoUpdateSources || !settings.sourceUrls.length) {
    return;
  }

  await chrome.alarms.create(SOURCE_SYNC_ALARM_NAME, {
    delayInMinutes: 0.5,
    periodInMinutes: SOURCE_SYNC_PERIOD_MINUTES
  });
}

async function syncSourceDomainsFromUrls(urls) {
  if (!urls.length) {
    await chrome.storage.local.set({ sourceDomains: [], lastSourceSyncAt: Date.now() });
    return;
  }

  const domains = await fetchDomainsFromSources(urls);
  await chrome.storage.local.set({
    sourceDomains: domains,
    lastSourceSyncAt: Date.now()
  });
}

async function fetchDomainsFromSources(urls) {
  const allDomains = [];

  for (const sourceUrl of urls) {
    try {
      const response = await fetch(sourceUrl, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      allDomains.push(...parseDomainsFromText(text));
    } catch {
      continue;
    }
  }

  return sanitizeDomains(allDomains).slice(0, 500);
}

function parseDomainsFromText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const domains = [];

  for (const line of lines) {
    const parsed = parseDomainFromLine(line);
    if (parsed) {
      domains.push(parsed);
    }
  }

  return sanitizeDomains(domains);
}

function parseDomainFromLine(line) {
  const value = String(line || '').trim();
  if (!value) {
    return '';
  }

  if (
    value.startsWith('!') ||
    value.startsWith('#') ||
    value.startsWith('[') ||
    value.startsWith('@@') ||
    value.includes('##') ||
    value.includes('#@#')
  ) {
    return '';
  }

  if (value.startsWith('||')) {
    const domain = value.replace(/^\|\|/, '').split(/[\^/$*]/)[0];
    return sanitizeDomain(domain);
  }

  return sanitizeDomain(value);
}

function sanitizeSourceUrls(urls) {
  return [...new Set(
    urls
      .map((url) => String(url).trim())
      .filter((url) => /^https?:\/\//i.test(url))
  )].slice(0, 20);
}

function extractHost(url) {
  try {
    return sanitizeDomain(new URL(url).hostname);
  } catch {
    return '';
  }
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
