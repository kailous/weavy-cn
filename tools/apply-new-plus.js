#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');
const baseFile = path.join(langDir, 'weavy-zh.json');
const newPlusFile = path.join(langDir, 'new+.json');

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing file: ${file}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid JSON structure in ${file}`);
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

function main() {
  try {
    const baseDict = readJson(baseFile);
    const newDict = readJson(newPlusFile);

    const entries = Object.entries(newDict);
    if (!entries.length) {
      console.log('No entries in new+.json to merge.');
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
    writeJson(newPlusFile, {});

    console.log(`Merged ${entries.length} entries (added: ${added}, updated: ${updated}) into weavy-zh.json and cleared new+.json`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
