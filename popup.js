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

  fetch(chrome.runtime.getURL('links.json'))
    .then(res => res.json())
    .then(links => {
      listEl.innerHTML = ''; // 清空加载提示
      
      links.forEach(item => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'nav-button';
        btn.textContent = item.title;
        
        btn.addEventListener('click', () => {
          // 判断当前活动标签页
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (currentTab && currentTab.url && currentTab.url.startsWith('https://app.weavy.ai/')) {
              // 在当前 weavy 标签页中跳转
              chrome.tabs.update(currentTab.id, { url: item.url });
            } else {
              // 新开标签页
              chrome.tabs.create({ url: item.url });
            }
            window.close(); // 点击后关闭面板
          });
        });

        li.appendChild(btn);
        listEl.appendChild(li);
      });
    })
    .catch(err => {
      console.error('[Weavy汉化] 加载 links.json 失败', err);
      listEl.innerHTML = '<li style="color:red; font-size:12px;">加载导航失败</li>';
    });
});
