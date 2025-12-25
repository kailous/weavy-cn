(() => {
  'use strict';

  const STORAGE_KEY = 'weavyTranslateEnabled';
  // ✅ 更稳的 raw URL（避免 refs/heads 302 等情况）
  const REMOTE_DICT_URL =
    'https://raw.githubusercontent.com/kailous/weavy-cn/main/lang/weavy-zh.json';

  let DICT = new Map();
  let observer = null;
  let started = false;
  let startPromise = null;

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
      // ✅ 浏览器扩展环境下可用；若是内容脚本，需确保该文件被打包且可访问
      { url: (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
          ? chrome.runtime.getURL('lang/weavy-zh.json')
          : '',
        label: '本地' },
    ].filter(s => s.url);

    for (const src of sources) {
      try {
        const map = await fetchDict(src.url);
        if (map) {
          DICT = map;
          console.log(`[Weavy汉化] 已加载${src.label}语言包`, src.url);
          return true;
        }
      } catch (err) {
        console.warn(`[Weavy汉化] ${src.label}语言包加载失败：${src.url}`, err);
      }
    }

    console.warn('[Weavy汉化] 语言包加载失败，无法进行翻译');
    return false;
  }

  // -------------------------
  // Hover Card 识别 + 标记
  // -------------------------
  function isModelHoverCard(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const text = (el.innerText || '').trim();
    if (!text) return false;

    // ✅ 更宽松、更贴近你页面真实文案
    if (text.includes('Verified by')) return true;
    if (text.includes('Apply') && text.includes('to')) return true;
    if (text.includes('From') && text.includes('to')) return true;
    if (text.includes('Generate') && (text.includes('based on') || text.includes('based'))) return true;

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
  // 排除用户输入区，避免动 prompt / thinking 等
  // -------------------------
  const EXCLUDE_SELECTOR = [
    'textarea',
    'input',
    '[contenteditable="true"]',
    'pre',
    'code',
  ].join(',');

  // -------------------------
  // 翻译核心：幂等 + 防叠加
  // -------------------------
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * ✅ 策略：
   * 1) 完全匹配：直接返回（最安全、不会叠加）
   * 2) 包含替换：只允许“长短语”，且词边界匹配，并且如果已有 zh 就不再替换
   *
   * 关键：禁止对短词(如 to/From/Alpha/Control 等)做包含替换，杜绝“通道通道通道”。
   */
  function translateString(str) {
    if (!str || typeof str !== 'string') return str;
    const s = str.trim();
    if (!s) return str;

    // 1) 完全匹配（直接返回，避免 replace 引起的二次变化）
    const exact = DICT.get(s);
    if (exact) return exact;

    // 2) 包含替换（谨慎）
    let out = str;

    for (const [en, zh] of DICT) {
      // ✅ 只对长短语做包含替换（你可以调这个阈值：6~10 都行）
      if (en.length < 6) continue;

      // ✅ 如果已经包含目标中文，跳过，防止重复叠加
      if (out.includes(zh)) continue;

      // ✅ 词边界匹配（英文短语更安全）
      const re = new RegExp(`\\b${escapeRegExp(en)}\\b`, 'g');
      if (re.test(out)) out = out.replace(re, zh);
    }

    return out;
  }

  // -------------------------
  // 属性翻译
  // -------------------------
  const ATTRS = ['aria-label', 'title', 'placeholder', 'value'];

  function translateAttrs(el) {
    for (const a of ATTRS) {
      if (!el?.hasAttribute?.(a)) continue;
      const v = el.getAttribute(a);
      if (!v) continue;
      const t = translateString(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }

  // -------------------------
  // 文本节点翻译
  // -------------------------
  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent) return;

    // 不翻用户输入区
    if (parent.closest(EXCLUDE_SELECTOR)) return;

    const raw = node.nodeValue;
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed) return;

    // ✅ hover card 允许更长的文本（描述句更长）
    const inHover = isInHoverCard(parent);
    const maxLen = inHover ? 200 : 60;

    if (trimmed.length > maxLen) return;
    if (/[{}\[\]<>]/.test(trimmed)) return;

    const t = translateString(raw);
    if (t !== raw) node.nodeValue = t;
  }

  // -------------------------
  // 扫描：对一个根节点做一次翻译
  // -------------------------
  function scan(root = document.body) {
    if (!root) return;

    // ✅ 避免对同一个元素重复 scan（hover card 新节点不受影响）
    if (root.nodeType === Node.ELEMENT_NODE) {
      const el = root;
      if (el.dataset?.weavyI18n === '1') return;
      if (el.dataset) el.dataset.weavyI18n = '1';
    }

    // 属性翻译
    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach(el => translateAttrs(el));
    } else if (root.nodeType === Node.ELEMENT_NODE) {
      translateAttrs(root);
    }

    // 文本翻译
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) translateTextNode(n);
  }

  // -------------------------
  // 监听 DOM 变化
  // -------------------------
  function observe() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // hover card 标记
              if (isModelHoverCard(node)) markHoverCard(node);
              // 直接扫描新增块
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

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ATTRS
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
        const ok = await loadDict();
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
    return new Promise(resolve => {
      if (!chrome?.storage?.sync) return resolve(true);
      chrome.storage.sync.get({ [STORAGE_KEY]: true }, res => {
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

  (async () => {
    const enabled = await getEnabled();
    if (enabled) {
      startTranslation();
    } else {
      console.log('[Weavy汉化] 已禁用（通过菜单）');
    }
  })();
})();
