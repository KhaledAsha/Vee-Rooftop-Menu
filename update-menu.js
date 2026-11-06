#!/usr/bin/env node
/*
 * update-menu.js
 * Refreshes the built-in (fallback) menu inside index.html from the Google Sheet.
 *
 * Usage (Node 18 or newer, no packages needed):
 *   node update-menu.js              fetch the published sheet (URL is read from index.html)
 *   node update-menu.js menu.csv     use a local CSV file instead (for testing)
 *   node update-menu.js --dry-run    show what would change, write nothing
 *
 * It reuses parseCSV, slug and csvToData from index.html, so the sheet rules
 * (columns, tab and category grouping) are defined in one place only.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'index.html');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const source = args.find((a) => !a.startsWith('--'));

function extractFunction(html, name) {
  const start = html.indexOf('      function ' + name + '(');
  if (start === -1) throw new Error('Could not find function ' + name + ' in index.html');
  const end = html.indexOf('\n      }\n', start);
  if (end === -1) throw new Error('Could not find the end of function ' + name);
  return html.slice(start, end + '\n      }'.length);
}

function countItems(groups) {
  return groups.reduce((n, g) => n + g.cats.reduce((m, c) => m + c.items.length, 0), 0);
}

function formatData(groups) {
  const lines = groups.map((g) => {
    const cats = g.cats.map((c) => {
      // Drop the empty description so the stored data stays small.
      const items = c.items.map((it) => (it.length === 3 && it[2] === '' ? it.slice(0, 2) : it));
      return ' ' + JSON.stringify({ name: c.name, items });
    });
    return '{"id":' + JSON.stringify(g.id) + ',"name":' + JSON.stringify(g.name) + ',"cats":[\n' + cats.join(',\n') + '\n]}';
  });
  // "<" is escaped so the data can never close the <script> tag early.
  return ('[\n' + lines.join(',\n') + '\n]').replace(/</g, '\\u003c');
}

async function main() {
  const html = fs.readFileSync(FILE, 'utf8');

  let csv;
  if (source) {
    csv = fs.readFileSync(path.resolve(source), 'utf8');
  } else {
    const m = html.match(/var SHEET_CSV_URL = '([^']+)'/);
    if (!m) throw new Error('SHEET_CSV_URL not found in index.html');
    const res = await fetch(m[1] + '&t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Sheet request failed: HTTP ' + res.status);
    csv = await res.text();
  }

  const code = ['slug', 'parseCSV', 'csvToData'].map((n) => extractFunction(html, n)).join('\n');
  const csvToData = new Function(code + '\nreturn csvToData;')();
  const groups = csvToData(csv);

  if (!groups.length) throw new Error('The sheet produced no menu items. index.html was not changed.');

  const open = '<script id="data" type="application/json">\n';
  const a = html.indexOf(open);
  const b = a === -1 ? -1 : html.indexOf('</script>', a);
  if (a === -1 || b === -1) throw new Error('Could not find the built-in data block in index.html');

  const oldGroups = JSON.parse(html.slice(a + open.length, b));
  const next = html.slice(0, a + open.length) + formatData(groups) + '\n' + html.slice(b);

  console.log('Before: ' + oldGroups.length + ' tabs, ' + countItems(oldGroups) + ' items');
  console.log('After:  ' + groups.length + ' tabs, ' + countItems(groups) + ' items');
  console.log('Tabs:   ' + groups.map((g) => g.name).join(', '));

  if (next === html) {
    console.log('No change: the built-in menu already matches the sheet.');
    return;
  }
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }
  fs.writeFileSync(FILE, next);
  console.log('index.html updated.');
}

main().catch((e) => {
  console.error('Error: ' + e.message);
  process.exit(1);
});
