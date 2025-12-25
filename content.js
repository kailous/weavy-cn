(() => {
  'use strict';

  let DICT = new Map();

  async function loadDict() {
    try {
      const res = await fetch(chrome.runtime.getURL('lang/weavy-zh.json'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && typeof data === 'object') {
        const pairs = Object.entries(data).filter(
          ([k, v]) => typeof k === 'string' && typeof v === 'string'
        );
        DICT = new Map(pairs);
      }
    } catch (err) {
      console.warn('[Weavy汉化] 语言包加载失败，请检查 lang/weavy-zh.json', err);
    }
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
            if (node.nodeType === Node.ELEMENT_NODE) scan(node);
            else if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
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
