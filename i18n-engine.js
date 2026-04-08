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
    'https://kailous.github.io/weavy-cn/lang/weavy-zh.json';

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

  // ========== 翻译引擎 ==========
  class I18nEngine {
    constructor() {
      this.dict = new Map();
      this.patternRules = [];
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

    setDict(map) {
      if (!map) return;
      this.dict = map;
      this.buildPatternRules();
      this.loaded = true;
    }

    async fetchJson(url) {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }

    async loadDict() {
      let initialData = null;

      // 1. 尝试从本地持久化缓存读取
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        initialData = await new Promise(resolve => {
          chrome.storage.local.get('weavy_dict_cache', res => resolve(res.weavy_dict_cache));
        });
      }

      // 2. 如果没有缓存，则读取扩展包内默认配置
      if (!initialData) {
        const localUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? chrome.runtime.getURL('lang/weavy-zh.json')
          : '';
        if (localUrl) {
          try {
            initialData = await this.fetchJson(localUrl);
          } catch(e) {
            console.warn('[Weavy汉化] 读取本地打包字典失败', e);
          }
        }
      }

      // 3. 立即应用缓存，确保页面无需等待远端请求即可开始翻译
      if (initialData) {
        const map = this.parseDict(initialData);
        if (map) {
          this.setDict(map);
          console.log(`[Weavy汉化] 已加载本地缓存字典，条目数: ${map.size}`);
        }
      }

      // 4. 非阻塞异步拉取远端最新字典 (Stale-While-Revalidate)
      this.fetchRemoteAndUpdateCache(initialData);

      return this.loaded;
    }

    async fetchRemoteAndUpdateCache(currentData) {
      try {
        const remoteData = await this.fetchJson(REMOTE_DICT_URL);
        
        // 比较远端和当前的字典条目数
        const curCount = currentData ? Object.keys(currentData).length : 0;
        const newCount = Object.keys(remoteData).length;

        // 保存到缓存
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
           chrome.storage.local.set({ weavy_dict_cache: remoteData });
        }

        if (newCount !== curCount) {
          console.log(`[Weavy汉化] 检测到远端字典更新 (${curCount} -> ${newCount}条)，正在热更新...`);
          const map = this.parseDict(remoteData);
          if (map) {
            this.setDict(map);
            // 触发全屏重扫，使更新即刻生效
            if (document.body) this.scan(document.body);
          }
        } else {
          console.log(`[Weavy汉化] 远端字典已是最新。`);
        }
      } catch (err) {
        console.warn('[Weavy汉化] 远端字典拉取失败，继续使用本地缓存:', err);
      }
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
      if (exact) return str.replace(s, exact);

      // 2) 占位符匹配（使用正则 ^...$ 保证整体匹配）
      const dyn = this.applyPatternRules(s);
      if (dyn) return str.replace(s, dyn);

      return str;
    }

    isAlreadyTranslated(text) {
      if (!text || typeof text !== 'string') return false;
      const key = text.trim();
      if (!key) return false;
      const translated = this.translateString(key);
      if (translated !== key) return true;

      // 额外检查：是否存在仅大小写不同的已翻译项（用于去重采集）
      const lowerKey = key.toLowerCase();
      for (const k of this.dict.keys()) {
        if (k.toLowerCase() === lowerKey) return true;
      }
      return false;
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

    translateTextNode(node) {
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      const parent = node.parentElement;
      if (!parent) return;

      // 不翻用户输入区
      if (parent.closest(EXCLUDE_SELECTOR)) return;

      const raw = node.nodeValue;
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
