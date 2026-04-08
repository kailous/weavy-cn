#!/usr/bin/env node
/**
 * i18n-cli.js — Weavy 汉化统一命令行工具
 *
 * 用法：
 *   node tools/i18n-cli.js diff       — 从 new.json 中剔除已翻译条目
 *   node tools/i18n-cli.js merge      — 将 new.json 中有翻译的条目合并进 weavy-zh.json
 *   node tools/i18n-cli.js pipeline   — 一键执行 diff → 提示翻译 → merge
 *   node tools/i18n-cli.js stats      — 显示字典统计信息
 *   node tools/i18n-cli.js validate   — 校验 JSON 格式和完整性
 */
const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');
const baseFile = path.join(langDir, 'weavy-zh.json');
const newFile = path.join(langDir, 'new.json');
const backupFile = path.join(langDir, 'weavy-zh.backup.json');

// ========== 工具函数 ==========

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`文件不存在: ${file}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`无效的 JSON 结构: ${file}`);
  }
  return data;
}

function writeJson(file, data) {
  const sorted = Object.keys(data)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = data[key];
      return acc;
    }, {});

  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function backup() {
  if (fs.existsSync(baseFile)) {
    fs.copyFileSync(baseFile, backupFile);
    console.log(`📦 已备份 weavy-zh.json → weavy-zh.backup.json`);
  }
}

// ========== 垃圾条目过滤 ==========

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function isJunkEntry(key) {
  // 纯 UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return true;
  // 包含 UUID 的 DOM ID（如 node-menu-trigger-xxx, run-model-button-xxx）
  if (UUID_RE.test(key)) return true;
  // 纯尺寸 (1024x1024)
  if (/^\d+x\d+$/.test(key)) return true;
  // 纯数字
  if (/^[\d.]+$/.test(key)) return true;
  // CSS 类名风格 (kebab-case, 无空格, 含连字符)
  if (/^[a-z][a-z0-9-]+$/i.test(key) && key.includes('-') && !key.includes(' ')) return true;
  // sentinel 标记
  if (/^sentinel/i.test(key)) return true;
  // 带文件扩展名的文件名
  if (/\.\w{2,4}$/.test(key) && !key.includes(' ')) return true;
  // 带文件扩展名的长文件名（含空格但整体像文件名）
  if (/\.(png|jpg|jpeg|gif|svg|webp|mp4|json|js|css)$/i.test(key)) return true;
  // simple-tabpanel-* 等内部标签
  if (/^simple-tabpanel-/i.test(key)) return true;
  // 邮箱
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return true;

  return false;
}

// ========== 子命令 ==========

/**
 * diff — 从 new.json 中移除已经在 weavy-zh.json 中的词条
 * 同时过滤掉明显不需要翻译的条目（纯数字/尺寸等）
 */
function cmdDiff() {
  const baseDict = readJson(baseFile);
  const newDict = readJson(newFile);

  const originalCount = Object.keys(newDict).length;
  const filtered = {};
  let removedDup = 0;
  let removedJunk = 0;

  for (const [key, value] of Object.entries(newDict)) {
    // 已存在于主字典中
    if (Object.prototype.hasOwnProperty.call(baseDict, key)) {
      removedDup++;
      continue;
    }

    // 过滤明显不需要翻译的条目
    const k = key.trim();
    if (isJunkEntry(k)) {
      removedJunk++;
      continue;
    }

    filtered[key] = value;
  }

  writeJson(newFile, filtered);

  const remaining = Object.keys(filtered).length;
  console.log(`📋 去重完成:`);
  console.log(`   原始条目: ${originalCount}`);
  console.log(`   已移除 (重复): ${removedDup}`);
  console.log(`   已移除 (无需翻译): ${removedJunk}`);
  console.log(`   待翻译: ${remaining}`);

  // 显示待翻译条目
  if (remaining > 0) {
    const emptyCount = Object.values(filtered).filter(
      (v) => v === ''
    ).length;
    if (emptyCount > 0) {
      console.log(`\n⚠️  其中 ${emptyCount} 条尚未填写翻译`);
    }
  }
}

/**
 * merge — 将 new.json 中有翻译值的条目合并进 weavy-zh.json
 */
function cmdMerge() {
  backup();

  const baseDict = readJson(baseFile);
  const newDict = readJson(newFile);

  const entries = Object.entries(newDict).filter(
    ([, value]) => typeof value === 'string' && value.trim() !== ''
  );

  if (!entries.length) {
    console.log('📭 new.json 中没有已翻译的条目可合并');
    return;
  }

  let added = 0;
  let updated = 0;
  for (const [key, value] of entries) {
    if (!Object.prototype.hasOwnProperty.call(baseDict, key)) {
      added++;
    } else if (baseDict[key] !== value) {
      updated++;
    }
    baseDict[key] = value;
  }

  writeJson(baseFile, baseDict);

  // 从 new.json 移除已合并的条目
  const remaining = {};
  for (const [key, value] of Object.entries(newDict)) {
    if (!entries.find(([k]) => k === key)) {
      remaining[key] = value;
    }
  }
  writeJson(newFile, remaining);

  console.log(`✅ 已合并 ${entries.length} 条 (新增: ${added}, 更新: ${updated})`);
  console.log(
    `   weavy-zh.json 总条目: ${Object.keys(baseDict).length}`
  );
  console.log(
    `   new.json 剩余待翻译: ${Object.keys(remaining).length}`
  );
}

/**
 * pipeline — 一键执行 diff → 提示 → merge
 */
function cmdPipeline() {
  console.log('🔄 === 第 1 步: 去重 ===\n');
  cmdDiff();

  console.log('\n🔄 === 第 2 步: 检查翻译 ===\n');

  const newDict = readJson(newFile);
  const emptyEntries = Object.entries(newDict).filter(
    ([, v]) => v === ''
  );

  if (emptyEntries.length > 0) {
    console.log(
      `⚠️  发现 ${emptyEntries.length} 条未翻译，请先补充翻译后再运行 merge:`
    );
    console.log(`   node tools/i18n-cli.js merge`);
    console.log(`\n未翻译条目预览 (前 10 条):`);
    emptyEntries.slice(0, 10).forEach(([key]) => {
      const display =
        key.length > 60 ? key.slice(0, 60) + '...' : key;
      console.log(`   • "${display}"`);
    });
    return;
  }

  console.log('✅ 所有条目已有翻译\n');
  console.log('🔄 === 第 3 步: 合并 ===\n');
  cmdMerge();

  console.log('\n🎉 汉化更新流水线完成！');
}

/**
 * stats — 字典统计
 */
function cmdStats() {
  const baseDict = readJson(baseFile);
  const baseKeys = Object.keys(baseDict);

  console.log('📊 Weavy 汉化字典统计:');
  console.log(`   weavy-zh.json 总条目: ${baseKeys.length}`);

  // 检查空值
  const emptyValues = baseKeys.filter(
    (k) => !baseDict[k] || baseDict[k].trim() === ''
  );
  if (emptyValues.length > 0) {
    console.log(`   ⚠️  空值条目: ${emptyValues.length}`);
  }

  // 检查含 %d 占位符的条目
  const patternKeys = baseKeys.filter((k) => k.includes('%d'));
  console.log(`   占位符模式条目: ${patternKeys.length}`);

  // 检查 new.json
  if (fs.existsSync(newFile)) {
    const newDict = readJson(newFile);
    const newKeys = Object.keys(newDict);
    const untranslated = newKeys.filter(
      (k) => newDict[k] === ''
    ).length;
    console.log(`   new.json 总条目: ${newKeys.length}`);
    console.log(`   new.json 待翻译: ${untranslated}`);
  }
}

/**
 * validate — JSON 校验
 */
function cmdValidate() {
  let hasError = false;

  // 校验 weavy-zh.json
  try {
    const data = readJson(baseFile);
    const keys = Object.keys(data);
    console.log(`✅ weavy-zh.json 格式正确 (${keys.length} 条)`);

    // 检查重复 key（JSON.parse 会自动覆盖，但我们检查排序后是否有相邻重复）
    const sorted = [...keys].sort();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1]) {
        console.log(`   ⚠️  发现重复 key: "${sorted[i]}"`);
        hasError = true;
      }
    }

    // 检查空值
    const emptyVals = keys.filter(
      (k) => typeof data[k] !== 'string' || data[k] === ''
    );
    if (emptyVals.length > 0) {
      console.log(`   ⚠️  ${emptyVals.length} 条空值`);
    }
  } catch (err) {
    console.error(`❌ weavy-zh.json 校验失败: ${err.message}`);
    hasError = true;
  }

  // 校验 new.json
  if (fs.existsSync(newFile)) {
    try {
      const data = readJson(newFile);
      console.log(
        `✅ new.json 格式正确 (${Object.keys(data).length} 条)`
      );
    } catch (err) {
      console.error(`❌ new.json 校验失败: ${err.message}`);
      hasError = true;
    }
  }

  process.exit(hasError ? 1 : 0);
}

// ========== 主入口 ==========

const command = process.argv[2];

switch (command) {
  case 'diff':
    cmdDiff();
    break;
  case 'merge':
    cmdMerge();
    break;
  case 'pipeline':
    cmdPipeline();
    break;
  case 'stats':
    cmdStats();
    break;
  case 'validate':
    cmdValidate();
    break;
  default:
    console.log(`Weavy 汉化 CLI 工具

用法: node tools/i18n-cli.js <command>

命令:
  diff        从 new.json 中剔除已翻译条目（去重）
  merge       将 new.json 中有翻译的条目合并进 weavy-zh.json
  pipeline    一键执行: diff → 检查 → merge
  stats       显示字典统计信息
  validate    校验 JSON 格式和完整性`);
    if (command) {
      console.error(`\n❌ 未知命令: ${command}`);
      process.exit(1);
    }
}
