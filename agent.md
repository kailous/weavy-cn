# 任务库

## 任务：新增汉化
- 目的：基于 `lang/new.json` 的人工输入词典，去重并完成翻译后合并进正式语言包。
- 输入：
  - `lang/new.json`（由你手工输入的英文词条，不需要我处理来源）
- 输出：
  - `lang/weavy-zh.json`（合并新增翻译后的语言包）
- 步骤：
  1. 运行去重：`node tools/i18n-cli.js diff`
  2. 对 `lang/new.json` 中值为空的条目完成中文翻译。
  3. 运行合并：`node tools/i18n-cli.js merge`
  4. 或一键执行全流程：`node tools/i18n-cli.js pipeline`
- 验收：
  - 运行 `node tools/i18n-cli.js validate` 通过
  - `lang/weavy-zh.json` 中无重复 key、无空值
  - 新增条目在页面可正确翻译

## CLI 快速参考
```bash
node tools/i18n-cli.js diff       # 去重
node tools/i18n-cli.js merge      # 合并
node tools/i18n-cli.js pipeline   # 一键: 去重 → 检查 → 合并
node tools/i18n-cli.js stats      # 查看统计
node tools/i18n-cli.js validate   # 校验 JSON
```

## 新任务模板
- 任务名称：
- 目的：
- 前置条件：
- 输入：
- 输出：
- 步骤：
- 验收：
- 备注/风险：
