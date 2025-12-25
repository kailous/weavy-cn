const STORAGE_KEY = 'weavyTranslateEnabled';
const MENU_ID = 'weavy-toggle-i18n';
const MATCH_URL = 'https://app.weavy.ai/*';

function getEnabled() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ [STORAGE_KEY]: true }, res => {
      resolve(Boolean(res[STORAGE_KEY]));
    });
  });
}

function setEnabled(enabled) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ [STORAGE_KEY]: Boolean(enabled) }, () => resolve());
  });
}

function broadcast(enabled) {
  chrome.tabs.query({ url: MATCH_URL }, tabs => {
    tabs.forEach(tab => {
      if (!tab.id) return;
      chrome.tabs.sendMessage(tab.id, {
        type: 'weavy-i18n-toggle',
        enabled: Boolean(enabled)
      });
    });
  });
}

function buildMenu() {
  getEnabled().then(enabled => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: enabled ? '关闭汉化' : '开启汉化',
        type: 'checkbox',
        checked: enabled,
        contexts: ['action']
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  buildMenu();
});

chrome.runtime.onStartup.addListener(() => {
  buildMenu();
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId !== MENU_ID) return;

  getEnabled().then(current => {
    const next = !current;
    setEnabled(next).then(() => {
      chrome.contextMenus.update(MENU_ID, {
        checked: next,
        title: next ? '关闭汉化' : '开启汉化'
      });
      broadcast(next);
    });
  });
});
