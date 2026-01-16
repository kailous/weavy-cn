const STORAGE_KEY = 'weavyTranslateEnabled';
const MENU_ID_TOGGLE = 'weavy-toggle-i18n';
const MENU_ID_EXPORT = 'weavy-export-i18n';
const MENU_ID_RESET = 'weavy-reset-i18n';
const MATCH_URL = 'https://app.weavy.ai/*';
const MATCH_ORIGIN = 'https://app.weavy.ai/';

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
        id: MENU_ID_TOGGLE,
        title: enabled ? '关闭汉化' : '开启汉化',
        type: 'checkbox',
        checked: enabled,
        contexts: ['action']
      });
      chrome.contextMenus.create({
        id: MENU_ID_EXPORT,
        title: '导出未翻译文案',
        contexts: ['action']
      });
      chrome.contextMenus.create({
        id: MENU_ID_RESET,
        title: '重置未翻译采集',
        contexts: ['action']
      });
    });
  });
}

function isWeavyTab(tab) {
  return Boolean(tab?.url && tab.url.startsWith(MATCH_ORIGIN));
}

function withActiveWeavyTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs.find(isWeavyTab);
    if (!tab?.id) {
      console.warn('[Weavy汉化] 未找到当前 Weavy 页面');
      return;
    }
    cb(tab);
  });
}

function sendDpexMessage(tabId, type, onOk) {
  chrome.tabs.sendMessage(tabId, { type }, res => {
    if (chrome.runtime.lastError) {
      console.warn('[Weavy汉化] DPEX 通信失败', chrome.runtime.lastError.message);
      return;
    }
    if (!res?.ok) {
      console.warn('[Weavy汉化] DPEX 返回异常', res);
      return;
    }
    onOk?.(res);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  buildMenu();
});

chrome.runtime.onStartup.addListener(() => {
  buildMenu();
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === MENU_ID_TOGGLE) {
    getEnabled().then(current => {
      const next = !current;
      setEnabled(next).then(() => {
        chrome.contextMenus.update(MENU_ID_TOGGLE, {
          checked: next,
          title: next ? '关闭汉化' : '开启汉化'
        });
        broadcast(next);
      });
    });
    return;
  }

  if (info.menuItemId === MENU_ID_EXPORT) {
    withActiveWeavyTab(tab => {
      sendDpexMessage(tab.id, 'WEAVY_I18N_EXPORT', res => {
        const json = JSON.stringify(res.data, null, 2);
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        chrome.tabs.create({ url });
      });
    });
    return;
  }

  if (info.menuItemId === MENU_ID_RESET) {
    withActiveWeavyTab(tab => {
      sendDpexMessage(tab.id, 'WEAVY_I18N_RESET', () => {
        console.log('[Weavy汉化] 未翻译采集已重置');
      });
    });
  }
});
