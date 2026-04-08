# Weavy 汉化 (Weavy-CN)

[![Release](https://img.shields.io/github/v/release/kailous/weavy-cn?color=blue&label=%E7%89%88%E6%9C%AC)](https://github.com/kailous/weavy-cn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Weavy 汉化是一款专为 [app.weavy.ai](https://app.weavy.ai/) 打造的浏览器扩展，能够实现全自动、高效率的 UI 汉化。采用先进的 SWR 缓存机制和精确匹配引擎，为您提供丝滑的中文使用体验。

---

## ✨ 核心特性

- **🚀 瞬时翻译 (SWR)**：利用 `Stale-While-Revalidate` 策略，优先加载本地缓存字典，打开即汉化，无需等待网络请求。
- **🛡️ 极致精确**：基于全量正则与精确字符串匹配，彻底杜绝局部错译。
- **🛰️ 云端同步**：自动从 GitHub Pages 拉取最新的汉化包，实现零感自动更新。
- **🔍 智能采集**：内置开发者采集工具，支持实时发现未翻译条目并一键导出。
- **🎨 弹出控制面板**：左键点击即可开启/关闭汉化，并提供自定义的快捷导航列表。

---

## 📦 安装方法

由于本插件目前主要用于深度汉化与定制，建议使用 **开发者模式** 安装：

1. **下载源码**：点击本页面右上角的 `Code` -> `Download ZIP` 并解压，或者使用命令：
   ```bash
   git clone https://github.com/kailous/weavy-cn.git
   ```
2. **访问扩展页面**：在 Chrome 浏览器地址栏输入 `chrome://extensions/` 并回车。
3. **开启开发者模式**：确保页面右上角的“开发者模式”开关已打开。
4. **加载插件**：点击左上角的“加载已解压的扩展程序”，选择刚才解压的 `weavy-cn` 文件夹。

---

## 🛠️ 开发者指南 (汉化工作流)

如果你想参与汉化的维护，可以利用内置的 `i18n-cli.js` 命令行工具：

### 1. 采集新词条
在 Weavy 页面右键点击扩展图标，选择 **“✨ 抓取当前视图未翻译文案”**。进入采集模式后，你在页面上看到的所有英文都会被自动提示并收集。

### 2. 导出与去重
在 Weavy 页面右键点击 **“📥 导出未翻译文案”**，这会将新词条写入 `lang/new.json`。
然后运行：
```bash
node tools/i18n-cli.js diff
```
这会自动移除已存在或无需翻译的垃圾数据。

### 3. 合并新翻译
在 `lang/new.json` 中填入翻译后，运行一键合并管道：
```bash
node tools/i18n-cli.js pipeline
```
合并成功后，推送到 GitHub 即可触发自动同步。

---

## 📝 配置导航菜单
你可以通过修改根目录下的 `links.json` 来自定义左键菜单中的快捷链接：
```json
[
  { "title": "工作区", "url": "https://app.weavy.ai/workspace" }
]
```

---

## 📜 开源协议
本项目采用 [MIT License](LICENSE) 开源协议。
