document.addEventListener('DOMContentLoaded', () => {
  const toggleEl = document.getElementById('toggle-i18n');
  const statusEl = document.getElementById('status-text');
  const listEl = document.getElementById('link-list');

  // ---------- 1. 初始化和控制汉化开关 ----------

  function updateUI(enabled) {
    toggleEl.checked = enabled;
    if (enabled) {
      statusEl.textContent = '汉化已开启';
      statusEl.classList.add('active');
    } else {
      statusEl.textContent = '汉化已关闭';
      statusEl.classList.remove('active');
    }
  }

  // 读取初始状态
  chrome.storage.sync.get({ weavyTranslateEnabled: true }, (res) => {
    updateUI(res.weavyTranslateEnabled);
  });

  // 监听开关切换
  toggleEl.addEventListener('change', (e) => {
    const nextState = e.target.checked;
    updateUI(nextState);
    
    // 发送消息给 background.js 统一处理状态分发和通知
    chrome.runtime.sendMessage({
      type: 'WEAVY_I18N_POPUP_TOGGLE',
      enabled: nextState
    });
  });

  // ---------- 2. 加载和渲染自定义导航列表 ----------

  function renderLinks(links) {
    if (!links || !Array.isArray(links)) return;
    listEl.innerHTML = ''; // 清空加载提示
    links.forEach(item => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'nav-button';
      btn.textContent = item.title;
      
      btn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.startsWith('https://app.weavy.ai/')) {
            chrome.tabs.update(currentTab.id, { url: item.url });
          } else {
            chrome.tabs.create({ url: item.url });
          }
          window.close();
        });
      });

      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  async function loadLinks() {
    let initialLinks = null;

    // 1. 尝试从本地持久化缓存读取
    if (chrome.storage && chrome.storage.local) {
      initialLinks = await new Promise(resolve => {
        chrome.storage.local.get('weavy_links_cache', res => resolve(res.weavy_links_cache));
      });
    }

    // 2. 如果没有缓存，则读取扩展包内默认配置
    if (!initialLinks) {
      const localUrl = chrome.runtime.getURL('links.json');
      try {
        const res = await fetch(localUrl);
        initialLinks = await res.json();
      } catch (e) {
        console.warn('[Weavy汉化] 读取本地 links.json 失败', e);
      }
    }

    // 3. 立即渲染
    if (initialLinks) {
      renderLinks(initialLinks);
    }

    // 4. 非阻塞异步拉取远端最新数据 (SWR)
    const remoteUrl = 'https://kailous.github.io/weavy-cn/links.json';
    try {
      const res = await fetch(remoteUrl, { cache: 'no-cache' });
      if (res.ok) {
        const remoteLinks = await res.json();
        // 更新缓存
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ weavy_links_cache: remoteLinks });
        }
        // 如果数据有变（简单通过长度判断，或者直接重新渲染），热更新 UI
        if (JSON.stringify(remoteLinks) !== JSON.stringify(initialLinks)) {
          renderLinks(remoteLinks);
        }
      }
    } catch (e) {
      console.warn('[Weavy汉化] 远端 links.json 拉取失败:', e);
    }
  }

  loadLinks().catch(err => {
    console.error('[Weavy汉化] 导航列表初始化失败', err);
    listEl.innerHTML = '<li style="color:red; font-size:12px;">加载导航失败</li>';
  });
});
