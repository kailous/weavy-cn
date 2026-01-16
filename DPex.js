(() => {
  'use strict';

  // ---------- 配置 ----------
  const OPT = {
    includeAttrs: true,
    attrs: ['aria-label', 'title', 'placeholder', 'value'],
    minLen: 2,
    maxLen: 800,                       // ✅ 原来 220，长描述会漏
    includeHidden: true,               // 抓隐藏元素文字（很多 UI 文案在 aria-only）
    maxNodes: 250000,                  // 防止卡死
    maxDepth: 12,                      // shadow/iframe 递归深度
    excludeSelector: ['textarea', 'input', '[contenteditable="true"]', 'pre', 'code'].join(',')
  };

  // ✅ 标准 raw URL（更稳）
  const TRANSLATION_SOURCES = [
    'https://raw.githubusercontent.com/kailous/weavy-cn/main/lang/weavy-zh--.json', // 预留：新版路径
    'https://raw.githubusercontent.com/kailous/weavy-cn/main/lang/weavy-zh.json'
  ];

  // ---------- 内部存储 ----------
  // key -> {count, samples:Set<string>, types:Set<string>}
  const STORE = new Map();
  let scannedNodes = 0;
  let translationSet = new Set();
  let translationMap = new Map();
  let translationPatternRules = [];
  let translationLoaded = false;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseTranslationDict(data) {
    if (!data || typeof data !== 'object') return null;
    const pairs = Object.entries(data).filter(
      ([k, v]) => typeof k === 'string' && typeof v === 'string'
    );
    return pairs.length ? new Map(pairs) : null;
  }

  function buildTranslationPatternRules() {
    translationPatternRules = [];
    if (!translationMap.size) return;
    const NUM_CAPTURE = '([0-9][0-9,]*(?:\\.[0-9]+)?)';
    for (const [key, tmpl] of translationMap) {
      if (!key.includes('%d')) continue;
      let source = escapeRegExp(key).replace(/%d/g, NUM_CAPTURE);
      source = source.replace(/\\ /g, '\\s+');
      source = '^' + source + '$';
      try {
        translationPatternRules.push({ re: new RegExp(source), tmpl });
      } catch {}
    }
  }

  function applyPatternRules(str) {
    for (const { re, tmpl } of translationPatternRules) {
      const m = str.match(re);
      if (m) {
        let i = 1;
        return tmpl.replace(/%d/g, () => m[i++] ?? '');
      }
    }
    return null;
  }

  function translateString(str) {
    if (!str || typeof str !== 'string') return str;
    const s = str.trim();
    if (!s) return str;

    const exact = translationMap.get(s);
    if (exact) return exact;

    const dyn = applyPatternRules(s);
    if (dyn) return dyn;

    let out = str;
    for (const [en, zh] of translationMap) {
      if (en.length < 6) continue;
      if (out.includes(zh)) continue;
      const re = new RegExp(`\\b${escapeRegExp(en)}\\b`, 'g');
      if (re.test(out)) out = out.replace(re, zh);
    }
    return out;
  }

  function isAlreadyTranslated(text) {
    if (!text || typeof text !== 'string') return false;
    const key = text.trim();
    if (!key) return false;
    const translated = translateString(key);
    return translated !== key;
  }

  async function loadTranslations() {
    translationLoaded = false;
    translationMap = new Map();
    translationSet = new Set();
    translationPatternRules = [];

    for (const url of TRANSLATION_SOURCES) {
      if (!url) continue;
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const map = parseTranslationDict(json);
        if (!map) throw new Error('Invalid translation payload');

        translationMap = map;
        translationSet = new Set(map.keys());
        buildTranslationPatternRules();
        translationLoaded = true;
        pruneStoreWithTranslations();
        console.log(`[Deep i18n Extractor] loaded translations: ${translationSet.size} (${url})`);
        return true;
      } catch (e) {
        console.warn('[Deep i18n Extractor] failed to load translations from', url, e);
      }
    }

    console.warn('[Deep i18n Extractor] no translation source loaded');
    return false;
  }

  function pruneStoreWithTranslations() {
    if (!translationSet.size && !translationPatternRules.length) return;
    for (const key of Array.from(STORE.keys())) {
      if (isAlreadyTranslated(key)) STORE.delete(key);
    }
  }

  function looksEnglishUI(s) {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();

    if (t.length < OPT.minLen) return false;

    // ✅ 极端超长（比如粘贴内容/日志）直接跳过，避免卡
    if (t.length > 2000) return false;

    // ✅ 未翻译候选的长度阈值（放宽到 800）
    if (t.length > OPT.maxLen) return false;

    // 必须含英文
    if (!/[A-Za-z]/.test(t)) return false;

    // 排除纯数字/尺寸/符号
    if (/^[\d\s./:%+-]+$/.test(t)) return false;
    // 排除明显代码/JSON/标签
    if (/[{}[\]<>`$]/.test(t)) return false;
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
      const cls = (node.className && typeof node.className === 'string')
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

    // ✅ 已翻译的就不再收集
    if (isAlreadyTranslated(key)) return;

    if (!STORE.has(key)) {
      STORE.set(key, { count: 0, samples: new Set(), types: new Set() });
    }
    const row = STORE.get(key);
    row.count += 1;
    row.types.add(type || 'text');
    if (el) row.samples.add(domPath(el));
  }

  function scanTextNodes(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(OPT.excludeSelector)) return NodeFilter.FILTER_REJECT;

        if (!OPT.includeHidden) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
        }

        const v = node.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
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

  // ---------- 实时监听新增 DOM ----------
  function observe() {
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
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
    });

    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: OPT.attrs
    });

    return mo;
  }

  // ---------- 导出 ----------
  function exportTemplate() {
    const rows = Array.from(STORE.entries())
      .filter(([key]) => !isAlreadyTranslated(key))
      .map(([key, v]) => ({
        key,
        count: v.count,
        types: Array.from(v.types),
        samples: Array.from(v.samples).slice(0, 3)
      }))
      .sort((a, b) => b.count - a.count);

    const template = {};
    for (const r of rows) template[r.key] = "";
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
    await loadTranslations();      // ✅ 先加载翻译 key，再扫（避免 prune/过滤时序问题）
    scanDeep(document, 0);
    observe();
    console.log('[Deep i18n Extractor] running');
  })();
})();
