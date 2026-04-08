# 更新日志 (Changelog)

本项目的所有显著更改都将记录在此文件中。

该格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，并且本项目遵循 [语义化版本 (Semantic Versioning)](https://semver.org/lang/zh-CN/)。

---

## [1.2.0] - 2026-04-08

### 🚀 新增 (Added)
- **左键控制面板**: 点击扩展图标可快速切换汉化状态及访问导航链接。
- **自定义导航列表**: 支持通过根目录 `links.json` 动态配置快捷跳转。
- **SWR (Stale-While-Revalidate) 缓存机制**: 汉化字典和链接列表优先加载本地缓存，后台静默拉取远端更新。
- **热更新逻辑**: 远端字典更新后，无需刷新页面即可自动应用新翻译。
- **GitHub Actions 自动发布**: 现在修改 `manifest.json` 版本号并推送即可自动打包 ZIP 并创建 Release。

### 🔄 变更 (Changed)
- **翻译逻辑增强**: 移除了包含匹配逻辑，全面改用“严格精确匹配”或“正则锚定匹配”，避免单词在长句中被错误翻译。
- **远端分发切换**: 字典和链接数据的远端地址从 GitHub Raw 切换到 GitHub Pages，提升了加载速度与缓存稳定性。

### 🐞 修复 (Fixed)
- **方括号识别**: 后台采集逻辑不再拦截包含 `[]` 的内容，支持 `[Beta]` 等带有括号的文案抓取。
- **权限修复**: 修正了 GitHub Release 权限问题 (403 Error)。
- **重复抓取**: 实现大小写模糊查重，防止已翻译的词条因大小写差异被重复采集。

---

[1.1.0]: https://github.com/kailous/weavy-cn/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kailous/weavy-cn/releases/tag/v1.0.0
