const AD_SELECTORS = [
  '[id^="google_ads_iframe"]',
  '[id*="banner-ad"]',
  '[id*="ad-slot"]',
  '[class^="ad-"]',
  '[class*=" ad-"]',
  '[class*="-ad-"]',
  '[class*=" ad_"]',
  '[class*="sponsored"]',
  '[data-ad]',
  '[data-ad-container]',
  '[data-ad-unit]',
  '[data-adblock-key]',
  '[data-testid*="ad"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="taboola.com"]',
  'iframe[id*="aswift"]',
  '.adsbygoogle',
  '.ad-container',
  '.ad-wrapper',
  '.ad-slot',
  '.ad-unit',
  '.advertisement',
  '.sponsored-content',
  '.promotedlink',
  '.taboola',
  '.outbrain',
  '.ytp-ad-module',
  '.video-ads',
  '.google-auto-placed'
];

let observer;
let styleElement;
let enabled = true;
let cosmeticFiltering = true;
let allowlistedDomains = [];
let youtubeInterval;
let tabPaused = false;

const pageHost = sanitizeDomain(window.location.hostname);
const isYouTubePage = pageHost === 'youtube.com' || pageHost.endsWith('.youtube.com');

init();

async function init() {
  const state = await chrome.storage.local.get({
    enabled: true,
    cosmeticFiltering: true,
    allowlistedDomains: []
  });

  enabled = Boolean(state.enabled);
  cosmeticFiltering = Boolean(state.cosmeticFiltering);
  allowlistedDomains = Array.isArray(state.allowlistedDomains) ? state.allowlistedDomains : [];
  tabPaused = await getTabPausedState();

  evaluateFiltering();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'tab-pause-updated') {
    return;
  }

  tabPaused = Boolean(message.paused);
  evaluateFiltering();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes.enabled) {
    enabled = Boolean(changes.enabled.newValue);
  }

  if (changes.cosmeticFiltering) {
    cosmeticFiltering = Boolean(changes.cosmeticFiltering.newValue);
  }

  if (changes.allowlistedDomains) {
    allowlistedDomains = Array.isArray(changes.allowlistedDomains.newValue)
      ? changes.allowlistedDomains.newValue
      : [];
  }

  evaluateFiltering();
});

function evaluateFiltering() {
  const canFilter = enabled && !tabPaused && !isHostInList(pageHost, allowlistedDomains);

  if (canFilter && isYouTubePage) {
    startYouTubeProtection();
  } else {
    stopYouTubeProtection();
  }

  if (canFilter && cosmeticFiltering && !isYouTubePage) {
    startFiltering();
  } else {
    stopFiltering();
  }
}

async function getTabPausedState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'is-tab-paused' });
    return Boolean(response?.paused);
  } catch {
    return false;
  }
}

function startFiltering() {
  injectStyle();
  hideAds();

  if (observer) {
    return;
  }

  observer = new MutationObserver(() => {
    hideAds();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function stopFiltering() {
  if (observer) {
    observer.disconnect();
    observer = undefined;
  }

  if (styleElement) {
    styleElement.remove();
    styleElement = undefined;
  }

  restoreHiddenElements();
}

function injectStyle() {
  if (styleElement) {
    return;
  }

  styleElement = document.createElement('style');
  styleElement.id = 'real-ad-blocker-style';
  styleElement.textContent = `${AD_SELECTORS.join(',\n')} {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    max-height: 0 !important;
    overflow: hidden !important;
  }`;

  document.documentElement.append(styleElement);
}

function hideAds() {
  for (const selector of AD_SELECTORS) {
    const elements = document.querySelectorAll(selector);

    for (const element of elements) {
      if (element.dataset.realAdBlockerHidden === '1') {
        continue;
      }

      element.dataset.realAdBlockerHidden = '1';
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
      element.style.setProperty('pointer-events', 'none', 'important');
      element.style.setProperty('max-height', '0', 'important');
      element.style.setProperty('overflow', 'hidden', 'important');
    }
  }
}

function restoreHiddenElements() {
  const elements = document.querySelectorAll('[data-real-ad-blocker-hidden="1"]');

  for (const element of elements) {
    element.style.removeProperty('display');
    element.style.removeProperty('visibility');
    element.style.removeProperty('pointer-events');
    element.style.removeProperty('max-height');
    element.style.removeProperty('overflow');
    delete element.dataset.realAdBlockerHidden;
  }
}

function startYouTubeProtection() {
  runYouTubeProtection();

  if (youtubeInterval) {
    return;
  }

  youtubeInterval = window.setInterval(runYouTubeProtection, 800);
}

function stopYouTubeProtection() {
  if (!youtubeInterval) {
    return;
  }

  clearInterval(youtubeInterval);
  youtubeInterval = undefined;
}

function runYouTubeProtection() {
  const skipButton = document.querySelector(
    '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
  );

  if (skipButton instanceof HTMLElement) {
    skipButton.click();
  }

  const adBadgeCloseButton = document.querySelector(
    '.ytp-ad-overlay-close-button, .ytp-ad-overlay-container button[aria-label*="Close"], .ytp-ad-overlay-container button[aria-label*="Zamknij"]'
  );

  if (adBadgeCloseButton instanceof HTMLElement) {
    adBadgeCloseButton.click();
  }

  const adElements = document.querySelectorAll(
    '.ytp-ad-overlay-container, .ytd-player-legacy-desktop-watch-ads-renderer, ytd-ad-slot-renderer'
  );

  for (const element of adElements) {
    if (element instanceof HTMLElement) {
      element.style.setProperty('display', 'none', 'important');
    }
  }
}

function isHostInList(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function sanitizeDomain(domain) {
  return String(domain)
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/:\d+$/, '');
}
