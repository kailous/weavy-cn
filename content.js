(() => {
  'use strict';

  const REMOTE_DICT_URL = 'https://raw.githubusercontent.com/kailous/weavy-cn/refs/heads/main/lang/weavy-zh.json';
  let DICT = new Map();

  function parseDict(data) {
    if (!data || typeof data !== 'object') return null;
    const pairs = Object.entries(data).filter(
      ([k, v]) => typeof k === 'string' && typeof v === 'string'
    );
    return pairs.length ? new Map(pairs) : null;
  }

  async function fetchDict(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseDict(data);
  }

  async function loadDict() {
    const sources = [
      { url: REMOTE_DICT_URL, label: '远程' },
      { url: chrome.runtime.getURL('lang/weavy-zh.json'), label: '本地' },
    ];

    for (const src of sources) {
      try {
        const map = await fetchDict(src.url);
        if (map) {
          DICT = map;
          console.log(`[Weavy汉化] 已加载${src.label}语言包`);
          return;
        }
      } catch (err) {
        console.warn(`[Weavy汉化] ${src.label}语言包加载失败：${src.url}`, err);
      }
    }

    console.warn('[Weavy汉化] 语言包加载失败，无法进行翻译');
  }

  function isModelHoverCard(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const text = el.innerText || '';
    if (text.includes('Generate a') && text.includes('based on')) return true;
    if (text.includes('From') && text.includes('to') && text.length < 200) return true;
    return false;
  }

  // 可选：排除输入区域，避免改动用户内容
  const EXCLUDE_SELECTOR = [
    'textarea',
    'input',
    '[contenteditable="true"]',
    'pre',
    'code',
  ].join(',');

  // 字符串翻译：先完全匹配，再包含替换
  function translateString(str) {
    if (!str || typeof str !== 'string') return str;
    const s = str.trim();
    if (!s) return str;

    if (DICT.has(s)) return str.replace(s, DICT.get(s));

    let out = str;
    for (const [en, zh] of DICT) {
      if (en.length < 3) continue; // 过短词不做包含替换
      if (out.includes(en)) out = out.split(en).join(zh);
    }
    return out;
  }

  // 替换元素属性
  const ATTRS = ['aria-label', 'title', 'placeholder', 'value'];
  function translateAttrs(el) {
    for (const a of ATTRS) {
      if (!el.hasAttribute?.(a)) continue;
      const v = el.getAttribute(a);
      const t = translateString(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }

  // 替换文本节点
  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent) return;
    if (parent.closest(EXCLUDE_SELECTOR)) return;

    const raw = node.nodeValue;
    if (!raw) return;

    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > 60) return;
    if (/[{}\[\]<>]/.test(trimmed)) return;

    const t = translateString(raw);
    if (t !== raw) node.nodeValue = t;
  }

  // 扫描一个根节点
  function scan(root = document.body) {
    root.querySelectorAll?.('*').forEach(el => translateAttrs(el));

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) translateTextNode(n);
  }

  // 监听 DOM 变化
  function observe() {
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isModelHoverCard(node)) {
                scan(node);
                return;
              }
              scan(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
              translateTextNode(node);
            }
          });
        } else if (m.type === 'attributes' && m.target) {
          translateAttrs(m.target);
        } else if (m.type === 'characterData') {
          translateTextNode(m.target);
        }
      }
    });

    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ATTRS
    });
  }

  (async () => {
    await loadDict();
    scan();
    observe();
    console.log('[Weavy汉化] 已启动');
  })();
})();
