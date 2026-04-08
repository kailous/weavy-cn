const STORAGE_KEY = 'weavyTranslateEnabled';
const MENU_ID_TOGGLE = 'weavy-toggle-i18n';
const MENU_ID_EXPORT = 'weavy-export-i18n';
const MENU_ID_DEEP_SCAN = 'weavy-deep-scan';
const MENU_ID_PRUNE = 'weavy-prune-i18n';
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

// ---------- Badge 更新 ----------

function setBadge(text, color = '#4CAF50') {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// ---------- 页面内 Toast 通知 ----------

function showToast(tabId, message, type = 'info') {
  // 注入 toast 到页面中
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, t) => {
      // 移除旧 toast
      const old = document.getElementById('weavy-i18n-toast');
      if (old) old.remove();

      const toast = document.createElement('div');
      toast.id = 'weavy-i18n-toast';

      const icons = { info: '💬', success: '✅', warning: '⚠️', scan: '🔍', error: '❌' };
      const colors = {
        info: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        success: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
        warning: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        scan: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        error: 'linear-gradient(135deg, #f5576c 0%, #ff6b6b 100%)',
      };

      toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        background: ${colors[t] || colors.info};
        color: #fff;
        padding: 14px 22px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        line-height: 1.5;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.15);
        backdrop-filter: blur(8px);
        opacity: 0;
        transform: translateX(120%);
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        max-width: 360px;
        pointer-events: auto;
        cursor: default;
        white-space: pre-line;
      `;

      toast.textContent = `${icons[t] || icons.info}  ${msg}`;
      document.body.appendChild(toast);

      // 滑入动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          toast.style.opacity = '1';
          toast.style.transform = 'translateX(0)';
        });
      });

      // 自动消失
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => toast.remove(), 400);
      }, 3500);
    },
    args: [message, type]
  }).catch(() => {});
}

// ---------- 菜单构建 ----------

function buildMenu() {
  getEnabled().then(enabled => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID_TOGGLE,
        title: enabled ? '✅ 关闭汉化' : '❌ 开启汉化',
        type: 'checkbox',
        checked: enabled,
        contexts: ['action']
      });

      chrome.contextMenus.create({
        type: 'separator',
        id: 'sep-1',
        contexts: ['action']
      });

      chrome.contextMenus.create({
        id: MENU_ID_DEEP_SCAN,
        title: '✨ 抓取当前视图未翻译文案',
        contexts: ['action']
      });

      chrome.contextMenus.create({
        id: MENU_ID_EXPORT,
        title: '📤 导出未翻译文案',
        contexts: ['action']
      });

      chrome.contextMenus.create({
        id: MENU_ID_PRUNE,
        title: '🧹 清理已翻译条目',
        contexts: ['action']
      });

      chrome.contextMenus.create({
        type: 'separator',
        id: 'sep-2',
        contexts: ['action']
      });

      chrome.contextMenus.create({
        id: MENU_ID_RESET,
        title: '🗑️ 重置采集数据',
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

function sendDpexMessage(tabId, type, onOk, payload = {}) {
  chrome.tabs.sendMessage(tabId, { type, ...payload }, res => {
    if (chrome.runtime.lastError) {
      console.warn('[Weavy汉化] DPex 通信失败', chrome.runtime.lastError.message);
      showToast(tabId, '通信失败，请刷新页面后重试', 'error');
      return;
    }
    if (!res?.ok) {
      console.warn('[Weavy汉化] DPex 返回异常', res);
      showToast(tabId, '操作异常，请打开控制台查看', 'error');
      return;
    }
    onOk?.(res);
  });
}

// ---------- 事件监听 ----------

chrome.runtime.onInstalled.addListener(() => {
  buildMenu();
});

chrome.runtime.onStartup.addListener(() => {
  buildMenu();
});

// 接收深度扫描完成通知
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender?.tab?.id;
  if (!tabId) return;

  if (msg?.type === 'WEAVY_I18N_DEEP_SCAN_DONE') {
    if (msg.ok) {
      showToast(tabId, `视图抓取完成\n共发现 ${msg.total} 条未翻译`, 'success');
      setBadge(String(msg.total), msg.total > 0 ? '#FF5722' : '#4CAF50');
    } else {
      showToast(tabId, '扫描正在进行中，请稍候…', 'warning');
    }
  }

  // 接收实时采集的文案反馈
  if (msg?.type === 'WEAVY_I18N_NEW_HITS') {
    const hits = msg.hits;
    if (hits && hits.length > 0) {
      setBadge(String(msg.total), '#FF5722');
      const sample = hits[0].length > 15 ? hits[0].substring(0, 15) + '...' : hits[0];
      const txt = hits.length === 1 
        ? `发现未翻译: "${sample}"`
        : `发现未翻译: "${sample}" 等 ${hits.length} 条`;
      showToast(tabId, txt, 'warning');
    }
  }

  // 接收来自 Popup 面板的开关控制
  if (msg?.type === 'WEAVY_I18N_POPUP_TOGGLE') {
    const next = Boolean(msg.enabled);
    setEnabled(next).then(() => {
      chrome.contextMenus.update(MENU_ID_TOGGLE, {
        checked: next,
        title: next ? '✅ 关闭汉化' : '❌ 开启汉化'
      });
      broadcast(next);
      withActiveWeavyTab(tab => {
        showToast(tab.id, next ? '汉化已开启' : '汉化已关闭', next ? 'success' : 'info');
      });
    });
  }
});

chrome.contextMenus.onClicked.addListener(info => {
  // 开关汉化
  if (info.menuItemId === MENU_ID_TOGGLE) {
    getEnabled().then(current => {
      const next = !current;
      setEnabled(next).then(() => {
        chrome.contextMenus.update(MENU_ID_TOGGLE, {
          checked: next,
          title: next ? '✅ 关闭汉化' : '❌ 开启汉化'
        });
        broadcast(next);
        withActiveWeavyTab(tab => {
          showToast(tab.id, next ? '汉化已开启' : '汉化已关闭', next ? 'success' : 'info');
        });
      });
    });
    return;
  }

  // 抓取当前视图
  if (info.menuItemId === MENU_ID_DEEP_SCAN) {
    withActiveWeavyTab(tab => {
      showToast(tab.id, '正在抓取当前视图…', 'scan');
      setBadge('...', '#2196F3');
      sendDpexMessage(tab.id, 'WEAVY_I18N_DEEP_SCAN', res => {
        if (res.started) {
          console.log('[Weavy汉化] 视图抓取已启动');
        }
      });
    });
    return;
  }

  // 导出
  if (info.menuItemId === MENU_ID_EXPORT) {
    withActiveWeavyTab(tab => {
      sendDpexMessage(tab.id, 'WEAVY_I18N_EXPORT', res => {
        const count = Object.keys(res.data).length;
        if (count === 0) {
          showToast(tab.id, '太棒了！没有发现未翻译的文案 🎉', 'success');
          clearBadge();
          return;
        }
        const json = JSON.stringify(res.data, null, 2);
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        chrome.tabs.create({ url });
        showToast(tab.id, `已导出 ${count} 条未翻译文案`, 'success');
        setBadge(String(count), '#FF5722');
      });
    });
    return;
  }

  // 清理已翻译
  if (info.menuItemId === MENU_ID_PRUNE) {
    withActiveWeavyTab(tab => {
      sendDpexMessage(tab.id, 'WEAVY_I18N_PRUNE', res => {
        showToast(
          tab.id,
          res.pruned > 0
            ? `已清理 ${res.pruned} 条已翻译项\n剩余 ${res.remaining} 条待翻译`
            : `无需清理，当前 ${res.remaining} 条待翻译`,
          res.pruned > 0 ? 'success' : 'info'
        );
        if (res.remaining > 0) {
          setBadge(String(res.remaining), '#FF5722');
        } else {
          clearBadge();
        }
      });
    });
    return;
  }

  // 重置
  if (info.menuItemId === MENU_ID_RESET) {
    withActiveWeavyTab(tab => {
      sendDpexMessage(tab.id, 'WEAVY_I18N_RESET', () => {
        showToast(tab.id, '采集数据已重置', 'info');
        clearBadge();
      });
    });
  }
});
