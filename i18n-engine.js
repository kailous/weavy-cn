/**
 * i18n-engine.js — Weavy 汉化共享翻译引擎
 *
 * 由 content.js 和 DPex.js 共同引用，统一字典加载、精确匹配、
 * 占位符模式匹配和包含替换逻辑。
 *
 * 性能优化：
 * - Trie 前缀树加速包含替换候选筛选（O(k) vs O(n)）
 * - 正则预编译 + 缓存
 */
(() => {
  'use strict';

  // ========== 配置 ==========
  const REMOTE_DICT_URL =
    'https://raw.githubusercontent.com/kailous/weavy-cn/main/lang/weavy-zh.json';

  const EXCLUDE_SELECTOR = [
    'textarea',
    'input',
    '[contenteditable="true"]',
    'pre',
    'code',
  ].join(',');

  const TRANSLATABLE_ATTRS = ['aria-label', 'title', 'placeholder', 'value'];

  // ========== 工具函数 ==========
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ========== Trie 前缀树 ==========
  class TrieNode {
    constructor() {
      this.children = new Map();
      this.entries = []; // 存到达此节点的完整 [en, zh] 词条
    }
  }

  class Trie {
    constructor() {
      this.root = new TrieNode();
    }

    insert(en, zh) {
      let node = this.root;
      // 只用前 6 个字符建索引（与最短包含替换阈值一致）
      const prefix = en.slice(0, 6).toLowerCase();
      for (const ch of prefix) {
        if (!node.children.has(ch)) {
          node.children.set(ch, new TrieNode());
        }
        node = node.children.get(ch);
      }
      node.entries.push([en, zh]);
    }

    /**
     * 找出所有可能匹配 text 中某子串的词条
     * 对 text 的每个位置尝试前缀匹配
     */
    findCandidates(text) {
      const result = [];
      const lower = text.toLowerCase();
      for (let i = 0; i < lower.length; i++) {
        let node = this.root;
        for (let j = i; j < Math.min(i + 6, lower.length); j++) {
          const ch = lower[j];
          if (!node.children.has(ch)) break;
          node = node.children.get(ch);
          if (node.entries.length > 0) {
            for (const entry of node.entries) {
              result.push(entry);
            }
          }
        }
      }
      return result;
    }
  }

  // ========== 翻译引擎 ==========
  class I18nEngine {
    constructor() {
      this.dict = new Map();
      this.patternRules = [];
      this.trie = new Trie();
      this.regexCache = new Map(); // en -> compiled RegExp
      this.loaded = false;
    }

    // ---------- 字典加载 ----------

    parseDict(data) {
      if (!data || typeof data !== 'object') return null;
      const pairs = Object.entries(data).filter(
        ([k, v]) => typeof k === 'string' && typeof v === 'string'
      );
      return pairs.length ? new Map(pairs) : null;
    }

    async fetchDict(url) {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return this.parseDict(data);
    }

    buildPatternRules() {
      this.patternRules = [];
      const NUM_CAPTURE = '([0-9][0-9,]*(?:\\.[0-9]+)?)';
      for (const [en, zh] of this.dict) {
        if (!en.includes('%d')) continue;
        let source = escapeRegExp(en).replace(/%d/g, NUM_CAPTURE);
        source = source.replace(/\\ /g, '\\s+');
        source = '^' + source + '$';
        try {
          this.patternRules.push({ re: new RegExp(source), tmpl: zh });
        } catch (err) {
          console.warn('[Weavy汉化] 占位符模式编译失败：', en, err);
        }
      }
    }

    buildTrie() {
      this.trie = new Trie();
      this.regexCache.clear();
      for (const [en, zh] of this.dict) {
        if (en.length < 6) continue; // 短词不做包含替换
        if (en.includes('%d')) continue; // 占位符词条单独处理
        this.trie.insert(en, zh);
        // 预编译正则
        this.regexCache.set(en, new RegExp(`\\b${escapeRegExp(en)}\\b`, 'g'));
      }
    }

    setDict(map) {
      this.dict = map;
      this.buildPatternRules();
      this.buildTrie();
      this.loaded = true;
    }

    async loadDict() {
      const sources = [
        { url: REMOTE_DICT_URL, label: '远程' },
        {
          url:
            typeof chrome !== 'undefined' && chrome.runtime?.getURL
              ? chrome.runtime.getURL('lang/weavy-zh.json')
              : '',
          label: '本地',
        },
      ].filter((s) => s.url);

      for (const src of sources) {
        try {
          const map = await this.fetchDict(src.url);
          if (map) {
            this.setDict(map);
            console.log(`[Weavy汉化] 已加载${src.label}语言包`, src.url);
            return true;
          }
        } catch (err) {
          console.warn(
            `[Weavy汉化] ${src.label}语言包加载失败：${src.url}`,
            err
          );
        }
      }

      console.warn('[Weavy汉化] 语言包加载失败，无法进行翻译');
      return false;
    }

    // ---------- 翻译核心 ----------

    applyPatternRules(str) {
      for (const { re, tmpl } of this.patternRules) {
        const m = str.match(re);
        if (m) {
          let i = 1;
          return tmpl.replace(/%d/g, () => m[i++] ?? '');
        }
      }
      return null;
    }

    translateString(str) {
      if (!str || typeof str !== 'string') return str;
      const s = str.trim();
      if (!s) return str;

      // 1) 完全匹配
      const exact = this.dict.get(s);
      if (exact) return exact;

      // 2) 占位符匹配
      const dyn = this.applyPatternRules(s);
      if (dyn) return dyn;

      // 3) 包含替换（Trie 优化）
      let out = str;
      const candidates = this.trie.findCandidates(out);

      // 去重
      const seen = new Set();
      for (const [en, zh] of candidates) {
        if (seen.has(en)) continue;
        seen.add(en);
        // 已经包含目标中文，跳过（防叠加）
        if (out.includes(zh)) continue;
        const re = this.regexCache.get(en);
        if (re) {
          re.lastIndex = 0; // 重置 global regex 状态
          if (re.test(out)) {
            re.lastIndex = 0;
            out = out.replace(re, zh);
          }
        }
      }

      return out;
    }

    isAlreadyTranslated(text) {
      if (!text || typeof text !== 'string') return false;
      const key = text.trim();
      if (!key) return false;
      const translated = this.translateString(key);
      return translated !== key;
    }

    // ---------- DOM 翻译 ----------

    translateAttrs(el) {
      for (const a of TRANSLATABLE_ATTRS) {
        if (!el?.hasAttribute?.(a)) continue;
        const v = el.getAttribute(a);
        if (!v) continue;
        const t = this.translateString(v);
        if (t !== v) el.setAttribute(a, t);
      }
    }

    translateTextNode(node, maxLen = 60) {
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      const parent = node.parentElement;
      if (!parent) return;

      // 不翻用户输入区
      if (parent.closest(EXCLUDE_SELECTOR)) return;

      const raw = node.nodeValue;
      if (!raw) return;
      const trimmed = raw.trim();
      if (!trimmed) return;

      // 精确匹配（不受长度限制）
      if (this.dict.has(trimmed)) {
        const t = this.dict.get(trimmed);
        if (t && t !== trimmed) node.nodeValue = raw.replace(trimmed, t);
        return;
      }

      // 占位符匹配
      const dyn = this.applyPatternRules(trimmed);
      if (dyn && dyn !== trimmed) {
        node.nodeValue = raw.replace(trimmed, dyn);
        return;
      }

      // 长度限制
      if (trimmed.length > maxLen) return;
      if (/[{}\[\]<>]/.test(trimmed)) return;

      const t = this.translateString(raw);
      if (t !== raw) node.nodeValue = t;
    }

    scan(root = document.body) {
      if (!root) return;

      // 属性翻译
      if (root.querySelectorAll) {
        root.querySelectorAll('*').forEach((el) => this.translateAttrs(el));
      } else if (root.nodeType === Node.ELEMENT_NODE) {
        this.translateAttrs(root);
      }

      // 文本翻译
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        null
      );
      let n;
      while ((n = walker.nextNode())) this.translateTextNode(n);
    }
  }

  // ========== 防抖 MutationObserver ==========

  /**
   * 创建一个带防抖功能的 MutationObserver
   * 使用 requestIdleCallback（不支持时 fallback setTimeout）将多次 mutation 合并为一次处理
   */
  function createDebouncedObserver(callback, delay = 150) {
    let pendingMutations = [];
    let idleHandle = null;
    const rIC =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback
        : (fn) => setTimeout(fn, delay);
    const cIC =
      typeof cancelIdleCallback !== 'undefined'
        ? cancelIdleCallback
        : clearTimeout;

    const flush = () => {
      if (pendingMutations.length === 0) return;
      const batch = pendingMutations;
      pendingMutations = [];
      callback(batch);
    };

    const observer = new MutationObserver((muts) => {
      pendingMutations.push(...muts);
      if (idleHandle !== null) cIC(idleHandle);
      idleHandle = rIC(flush, { timeout: delay + 50 });
    });

    return observer;
  }

  // ========== 导出到全局 ==========
  window.__WeavyI18n = {
    I18nEngine,
    createDebouncedObserver,
    EXCLUDE_SELECTOR,
    TRANSLATABLE_ATTRS,
    escapeRegExp,
  };
})();
