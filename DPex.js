(() => {
  'use strict';

  // ---------- 配置 ----------
  const OPT = {
    includeAttrs: true,
    attrs: ['aria-label', 'title', 'placeholder', 'value', 'alt', 'data-tooltip'],
    minLen: 2,
    maxLen: 800,
    includeHidden: true,
    maxNodes: 500000,
    maxDepth: 16,
    excludeSelector: [
      'textarea',
      'input',
      '[contenteditable="true"]',
      'pre',
      'code',
      'script',
      'style',
      'noscript',
    ].join(','),
    // 深度扫描：自动滚动间隔 ms
    deepScanScrollInterval: 400,
    // 深度扫描：最大滚动次数
    deepScanMaxScrolls: 50,
    // 周期扫描间隔 ms
    periodicScanInterval: 15000,
  };

  // ---------- 引用共享引擎 ----------
  const { createDebouncedObserver } = window.__WeavyI18n;

  function getEngine() {
    return window.__WeavyI18nInstance;
  }

  // ---------- 内部存储 ----------
  // key -> {count, samples:Set<string>, types:Set<string>, firstSeen:number}
  const STORE = new Map();
  let scannedNodes = 0;
  let periodicTimer = null;
  let deepScanRunning = false;

  // ---------- 翻译过滤缓存 ----------
  // 缓存已确认为"已翻译"的 key，避免每次都调用 engine.isAlreadyTranslated
  const translatedCache = new Set();

  function isTranslated(key) {
    if (translatedCache.has(key)) return true;
    const engine = getEngine();
    if (!engine?.loaded) return false;

    // 精确匹配
    if (engine.dict.has(key)) {
      translatedCache.add(key);
      return true;
    }

    // 占位符模式匹配
    const dyn = engine.applyPatternRules(key);
    if (dyn !== null) {
      translatedCache.add(key);
      return true;
    }

    // 完整 translateString 检查（含包含替换）
    const translated = engine.translateString(key);
    if (translated !== key) {
      translatedCache.add(key);
      return true;
    }

    return false;
  }

  // 当字典更新时清空缓存
  function invalidateCache() {
    translatedCache.clear();
  }

  // ---------- 过滤与采集 ----------

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function looksEnglishUI(s) {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();

    if (t.length < OPT.minLen) return false;
    if (t.length > 2000) return false;
    if (t.length > OPT.maxLen) return false;

    // 必须含英文字母
    if (!/[A-Za-z]/.test(t)) return false;
    // 排除纯数字/尺寸/符号
    if (/^[\d\s./:%+-]+$/.test(t)) return false;
    // 排除代码/JSON/标签
    if (/[{}\[\]<>`$]/.test(t)) return false;
    // 排除 URL
    if (/^https?:\/\//i.test(t)) return false;

    // ★ 排除 UUID（纯 UUID 或包含 UUID 的内部标识符）
    if (UUID_RE.test(t)) return false;
    // ★ 排除纯 hex hash
    if (/^[0-9a-f]{8,}$/i.test(t)) return false;
    // ★ 排除 kebab-case 标识符（无空格，含连字符，如 model-node-footer）
    if (/^[a-z][a-z0-9-]+$/i.test(t) && t.includes('-') && !t.includes(' ')) return false;
    // ★ 排除 snake_case 标识符（无空格，含下划线）
    if (/^[a-z][a-z0-9_]+$/i.test(t) && t.includes('_') && !t.includes(' ')) return false;
    // ★ 排除 camelCase 变量名（无空格，首字母小写，含大写）
    if (/^[a-z][a-zA-Z0-9]+$/.test(t) && /[A-Z]/.test(t) && !t.includes(' ')) return false;
    // ★ 排除带文件扩展名的文件名
    if (/\.(png|jpg|jpeg|gif|svg|webp|mp4|webm|json|js|css|html|txt|pdf|zip)$/i.test(t)) return false;
    // ★ 排除纯尺寸 (1024x1024)
    if (/^\d+x\d+$/.test(t)) return false;
    // ★ 排除 sentinel 类内部标记
    if (/^sentinel/i.test(t)) return false;

    // 排除邮箱
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return false;
    // 排除纯文件路径
    if (/^\//.test(t) && /\.\w+$/.test(t)) return false;
    // 过滤已包含中文的条目
    if (/[\u4e00-\u9fff]/.test(t)) return false;
    // 排除 debug 信息
    if (/^Edge from [0-9a-f-]{8,}/i.test(t)) return false;

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

  // ---------- 实时反馈队列 ----------
  let feedbackEnabled = false;
  let newHitsQueue = [];
  let feedbackTimer = null;

  function flushFeedback() {
    if (newHitsQueue.length === 0) return;
    try {
      chrome.runtime.sendMessage({
        type: 'WEAVY_I18N_NEW_HITS',
        hits: newHitsQueue,
        total: STORE.size
      });
    } catch {}
    newHitsQueue = [];
  }

  function addHit(text, el, type) {
    if (!looksEnglishUI(text)) return;
    const key = text.trim();

    // ★ 核心过滤：已翻译的就不再收集
    if (isTranslated(key)) return;

    let isNew = false;
    if (!STORE.has(key)) {
      isNew = true;
      STORE.set(key, {
        count: 0,
        samples: new Set(),
        types: new Set(),
        firstSeen: Date.now(),
      });
    }
    const row = STORE.get(key);
    row.count += 1;
    row.types.add(type || 'text');
    if (el && row.samples.size < 5) row.samples.add(domPath(el));

    // 触发实时反馈
    if (isNew && feedbackEnabled) {
      newHitsQueue.push(key);
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(flushFeedback, 300);
    }
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

      // 属性扫描
      if (OPT.includeAttrs) {
        for (const a of OPT.attrs) {
          if (!el.hasAttribute?.(a)) continue;
          const v = el.getAttribute(a);
          if (v && v.trim()) addHit(v, el, `attr:${a}`);
        }
      }

      // data-tooltip 等用户可见的 data 属性（仅限白名单）
      const DATA_WHITELIST = ['tooltip', 'label', 'description', 'placeholder', 'content'];
      if (el.dataset) {
        for (const dataKey of DATA_WHITELIST) {
          const dataVal = el.dataset[dataKey];
          if (dataVal && typeof dataVal === 'string' && dataVal.trim().length >= OPT.minLen) {
            addHit(dataVal, el, `data:${dataKey}`);
          }
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

  // ---------- ★ 手动扫描当前视图 ----------

  async function deepScan() {
    if (deepScanRunning) {
      return { ok: false, reason: 'already_running' };
    }

    deepScanRunning = true;
    feedbackEnabled = true; // 开启实时反馈模式
    const beforeCount = STORE.size;

    try {
      // 仅做一轮针对当前可见 DOM 的深度遍历
      scannedNodes = 0;
      scanDeep(document, 0);

      // 二次去重已翻译项
      pruneTranslated();

      const afterCount = STORE.size;
      const newFound = Math.max(0, afterCount - beforeCount);

      return { ok: true, newFound, total: afterCount };
    } finally {
      deepScanRunning = false;
    }
  }

  // ---------- ★ 周期性扫描 ----------

  function startPeriodicScan() {
    if (periodicTimer) return;
    periodicTimer = setInterval(() => {
      scannedNodes = 0;
      scanDeep(document, 0);
      pruneTranslated();
    }, OPT.periodicScanInterval);
    console.log(
      `[DPex] 周期扫描已启动 (每 ${OPT.periodicScanInterval / 1000}s)`
    );
  }

  function stopPeriodicScan() {
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
      console.log('[DPex] 周期扫描已停止');
    }
  }

  // ---------- ★ 清理已翻译项 ----------

  function pruneTranslated() {
    let pruned = 0;
    for (const key of Array.from(STORE.keys())) {
      if (isTranslated(key)) {
        STORE.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`[DPex] 🧹 清理了 ${pruned} 条已翻译项`);
    }
    return pruned;
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
    // 导出前再做一轮过滤
    pruneTranslated();

    const rows = Array.from(STORE.entries())
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

  function getStats() {
    const engine = getEngine();
    return {
      collected: STORE.size,
      dictSize: engine?.dict?.size || 0,
      cacheSize: translatedCache.size,
      scannedNodes,
      deepScanRunning,
      periodicRunning: !!periodicTimer,
    };
  }

  function resetStore() {
    STORE.clear();
    translatedCache.clear();
    scannedNodes = 0;
  }

  // ---------- 工具 ----------

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------- 与 background 通信 ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'WEAVY_I18N_EXPORT') {
      sendResponse({ ok: true, data: exportTemplate() });
    } else if (msg.type === 'WEAVY_I18N_RESET') {
      resetStore();
      scannedNodes = 0;
      scanDeep(document, 0);
      sendResponse({ ok: true });
    } else if (msg.type === 'WEAVY_I18N_PING') {
      sendResponse({ ok: true });
    } else if (msg.type === 'WEAVY_I18N_DEEP_SCAN') {
      // 异步深度扫描
      deepScan().then((result) => {
        // 扫描完成后发一条通知回 background
        chrome.runtime.sendMessage({
          type: 'WEAVY_I18N_DEEP_SCAN_DONE',
          ...result,
        });
      });
      sendResponse({ ok: true, started: true });
      return true; // keep channel open
    } else if (msg.type === 'WEAVY_I18N_PRUNE') {
      const pruned = pruneTranslated();
      sendResponse({ ok: true, pruned, remaining: STORE.size });
    } else if (msg.type === 'WEAVY_I18N_STATS') {
      sendResponse({ ok: true, data: getStats() });
    }
  });

  // ---------- 启动 ----------

  (async () => {
    resetStore();

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
    startPeriodicScan();
    console.log(`[DPex] 🚀 running | dict: ${getEngine()?.dict?.size || 0} 条`);
  })();
})();
