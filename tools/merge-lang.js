#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');
const baseFile = path.join(langDir, 'weavy-zh.json');
const newFile = path.join(langDir, 'new.json');
const outFile = path.join(langDir, 'new+.json');

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing file: ${file}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid JSON structure in ${file}`);
  }
  return data;
}

function diffEntries(source, target) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      result[key] = value;
    }
  }
  return result;
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

function main() {
  try {
    const baseDict = readJson(baseFile);
    const newDict = readJson(newFile);
    const onlyInNew = diffEntries(newDict, baseDict);
    writeJson(outFile, onlyInNew);
    console.log(`Wrote ${Object.keys(onlyInNew).length} entries to ${outFile}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
