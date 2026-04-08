(() => {
  'use strict';

  const STORAGE_KEY = 'weavyTranslateEnabled';

  // 引用共享引擎
  const { I18nEngine, createDebouncedObserver } = window.__WeavyI18n;
  const engine = new I18nEngine();

  let observer = null;
  let started = false;
  let startPromise = null;

  // -------------------------
  // Hover Card 识别 + 标记
  // -------------------------
  function isModelHoverCard(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const text = (el.innerText || '').trim();
    if (!text) return false;

    if (text.includes('Verified by')) return true;
    if (text.includes('Apply') && text.includes('to')) return true;
    if (text.includes('From') && text.includes('to')) return true;
    if (
      text.includes('Generate') &&
      (text.includes('based on') || text.includes('based'))
    )
      return true;

    return false;
  }

  function markHoverCard(el) {
    try {
      el.setAttribute('data-weavy-hovercard', '1');
    } catch {}
  }

  function isInHoverCard(el) {
    return !!el?.closest?.('[data-weavy-hovercard="1"]');
  }

  // -------------------------
  // 扫描：对一个根节点做一次翻译
  // -------------------------
  function scan(root = document.body) {
    if (!root) return;

    // 避免对同一个元素重复 scan
    if (root.nodeType === Node.ELEMENT_NODE) {
      const el = root;
      if (el.dataset?.weavyI18n === '1') return;
      if (el.dataset) el.dataset.weavyI18n = '1';
    }

    // 属性翻译
    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach((el) => engine.translateAttrs(el));
    } else if (root.nodeType === Node.ELEMENT_NODE) {
      engine.translateAttrs(root);
    }

    // 文本翻译
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    );
    let n;
    while ((n = walker.nextNode())) {
      const parent = n.parentElement;
      const inHover = parent ? isInHoverCard(parent) : false;
      const maxLen = inHover ? 200 : 60;
      engine.translateTextNode(n, maxLen);
    }
  }

  // -------------------------
  // 监听 DOM 变化（防抖批量处理）
  // -------------------------
  function observe() {
    if (observer) observer.disconnect();

    observer = createDebouncedObserver((mutations) => {
      // 收集所有需要处理的节点，批量去重
      const nodesToScan = new Set();
      const textNodesToTranslate = [];
      const attrsToTranslate = [];

      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isModelHoverCard(node)) markHoverCard(node);
              nodesToScan.add(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
              textNodesToTranslate.push(node);
            }
          });
        } else if (m.type === 'attributes' && m.target) {
          attrsToTranslate.push(m.target);
        } else if (m.type === 'characterData') {
          textNodesToTranslate.push(m.target);
        }
      }

      // 批量处理
      for (const node of nodesToScan) {
        scan(node);
      }
      for (const node of textNodesToTranslate) {
        engine.translateTextNode(node);
      }
      for (const el of attrsToTranslate) {
        engine.translateAttrs(el);
      }
    }, 150);

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['aria-label', 'title', 'placeholder', 'value'],
    });
  }

  function stopTranslation() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    started = false;
    startPromise = null;
    console.log('[Weavy汉化] 已关闭');
  }

  async function startTranslation() {
    if (started) return true;
    if (!startPromise) {
      startPromise = (async () => {
        const ok = await engine.loadDict();
        if (!ok) {
          startPromise = null;
          return false;
        }
        scan(document.body);
        observe();
        started = true;
        console.log('[Weavy汉化] 已启动');
        return true;
      })();
    }
    return startPromise;
  }

  function getEnabled() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync) return resolve(true);
      chrome.storage.sync.get({ [STORAGE_KEY]: true }, (res) => {
        resolve(Boolean(res[STORAGE_KEY]));
      });
    });
  }

  function handleToggle(enabled) {
    if (enabled) {
      startTranslation();
    } else {
      stopTranslation();
    }
  }

  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'weavy-i18n-toggle') {
      handleToggle(Boolean(msg.enabled));
      sendResponse?.({ ok: true });
    }
  });

  // 导出引擎实例供 DPex.js 复用
  window.__WeavyI18nInstance = engine;

  (async () => {
    const enabled = await getEnabled();
    if (enabled) {
      startTranslation();
    } else {
      console.log('[Weavy汉化] 已禁用（通过菜单）');
    }
  })();
})();
