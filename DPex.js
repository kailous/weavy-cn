(() => {
  'use strict';

  // ---------- 配置 ----------
  const OPT = {
    includeAttrs: true,
    attrs: ['aria-label', 'title', 'placeholder', 'value'],
    minLen: 2,
    maxLen: 800,
    includeHidden: true,
    maxNodes: 250000,
    maxDepth: 12,
    excludeSelector: [
      'textarea',
      'input',
      '[contenteditable="true"]',
      'pre',
      'code',
    ].join(','),
  };

  // ---------- 引用共享引擎 ----------
  const { createDebouncedObserver, escapeRegExp } = window.__WeavyI18n;

  // engine 实例由 content.js 初始化后挂到 window 上
  // DPex 在 content.js 之后加载，所以可以直接引用
  function getEngine() {
    return window.__WeavyI18nInstance;
  }

  // ---------- 内部存储 ----------
  // key -> {count, samples:Set<string>, types:Set<string>}
  const STORE = new Map();
  let scannedNodes = 0;

  // ---------- 过滤与采集 ----------

  function looksEnglishUI(s) {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();

    if (t.length < OPT.minLen) return false;
    if (t.length > 2000) return false;
    if (t.length > OPT.maxLen) return false;

    // 必须含英文
    if (!/[A-Za-z]/.test(t)) return false;
    // 排除纯数字/尺寸/符号
    if (/^[\d\s./:%+-]+$/.test(t)) return false;
    // 排除代码/JSON/标签
    if (/[{}\[\]<>`$]/.test(t)) return false;
    // 排除 URL
    if (/^https?:\/\//i.test(t)) return false;
    // 排除 debug
    if (/^Edge from [0-9a-f-]{8,}/i.test(t)) return false;
    // 过滤包含中文的条目
    if (/[\u4e00-\u9fff]/.test(t)) return false;

    return true;
  }

  function domPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      let p = node.tagName.toLowerCase();
      if (node.id) p += `#${node.id}`;
      const cls =
        node.className && typeof node.className === 'string'
          ? node.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
      if (cls) p += `.${cls}`;
      parts.unshift(p);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function addHit(text, el, type) {
    if (!looksEnglishUI(text)) return;
    const key = text.trim();

    // 已翻译的就不再收集
    const engine = getEngine();
    if (engine?.loaded && engine.isAlreadyTranslated(key)) return;

    if (!STORE.has(key)) {
      STORE.set(key, { count: 0, samples: new Set(), types: new Set() });
    }
    const row = STORE.get(key);
    row.count += 1;
    row.types.add(type || 'text');
    if (el) row.samples.add(domPath(el));
  }

  // ---------- 扫描 ----------

  function scanTextNodes(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(OPT.excludeSelector))
          return NodeFilter.FILTER_REJECT;

        if (!OPT.includeHidden) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
        }

        const v = node.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let n;
    while ((n = tw.nextNode())) {
      scannedNodes++;
      if (scannedNodes > OPT.maxNodes) return;
      addHit(n.nodeValue, n.parentElement, 'text');
    }
  }

  function scanAttrsAndRecurse(root, depth = 0) {
    if (!root || depth > OPT.maxDepth) return;
    if (scannedNodes > OPT.maxNodes) return;

    const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of els) {
      scannedNodes++;
      if (scannedNodes > OPT.maxNodes) return;
      if (el.closest?.(OPT.excludeSelector)) continue;

      if (OPT.includeAttrs) {
        for (const a of OPT.attrs) {
          if (!el.hasAttribute?.(a)) continue;
          const v = el.getAttribute(a);
          if (v && v.trim()) addHit(v, el, `attr:${a}`);
        }
      }

      // Shadow DOM
      if (el.shadowRoot) {
        scanDeep(el.shadowRoot, depth + 1);
        if (scannedNodes > OPT.maxNodes) return;
      }

      // same-origin iframe
      if (el.tagName === 'IFRAME') {
        try {
          const doc = el.contentDocument;
          if (doc) scanDeep(doc, depth + 1);
        } catch {}
      }
    }
  }

  function scanDeep(root, depth = 0) {
    if (!root || scannedNodes > OPT.maxNodes) return;
    scanTextNodes(root);
    scanAttrsAndRecurse(root, depth);
  }

  // ---------- 实时监听新增 DOM（防抖） ----------
  function observe() {
    const mo = createDebouncedObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((node) => {
            if (scannedNodes > OPT.maxNodes) return;
            if (node.nodeType === Node.TEXT_NODE) {
              addHit(node.nodeValue || '', node.parentElement, 'text');
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              scanDeep(node, 0);
            }
          });
        } else if (m.type === 'attributes') {
          const el = m.target;
          const name = m.attributeName;
          if (OPT.includeAttrs && OPT.attrs.includes(name)) {
            addHit(el.getAttribute(name) || '', el, `attr:${name}`);
          }
        } else if (m.type === 'characterData') {
          const n = m.target;
          addHit(n.nodeValue || '', n.parentElement, 'text');
        }
      }
    }, 200);

    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: OPT.attrs,
    });

    return mo;
  }

  // ---------- 导出 ----------
  function exportTemplate() {
    const engine = getEngine();
    const rows = Array.from(STORE.entries())
      .filter(
        ([key]) => !(engine?.loaded && engine.isAlreadyTranslated(key))
      )
      .map(([key, v]) => ({
        key,
        count: v.count,
        types: Array.from(v.types),
        samples: Array.from(v.samples).slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count);

    const template = {};
    for (const r of rows) template[r.key] = '';
    return template;
  }

  function resetStore() {
    STORE.clear();
    scannedNodes = 0;
  }

  // ---------- 与 popup 通信 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'WEAVY_I18N_EXPORT') {
      sendResponse({ ok: true, data: exportTemplate() });
    } else if (msg.type === 'WEAVY_I18N_RESET') {
      resetStore();
      scanDeep(document, 0);
      sendResponse({ ok: true });
    } else if (msg.type === 'WEAVY_I18N_PING') {
      sendResponse({ ok: true });
    }
  });

  // ---------- 启动 ----------
  (async () => {
    resetStore();
    // 等待 content.js 完成引擎初始化
    const waitForEngine = () =>
      new Promise((resolve) => {
        const check = () => {
          const eng = getEngine();
          if (eng?.loaded) return resolve();
          setTimeout(check, 100);
        };
        check();
      });

    await waitForEngine();
    scanDeep(document, 0);
    observe();
    console.log('[Deep i18n Extractor] running');
  })();
})();
