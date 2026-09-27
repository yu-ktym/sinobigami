// Usage: node import-ninpo-csv.js "C:\path\to\忍法データベース.csv"
// ローカルサーバーが http://127.0.0.1:8787 で起動している状態で実行します。
const fs = require('fs/promises');

const source = process.argv[2];
if (!source) throw new Error('CSVファイルのパスを指定してください。');
const API = process.env.SHINOBIGAMI_API || 'http://127.0.0.1:8787';

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const [headers, ...body] = rows;
  return body.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, i) => [header.replace(/^\uFEFF/, ''), (values[i] || '').trim()])));
}
async function api(path, options) {
  const response = await fetch(API + path, options);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}
async function add(collection, data) {
  return api('/api/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: collection, data }) });
}
const key = (...values) => values.map((value) => String(value || '').trim()).join('\u001f');

(async () => {
  const rows = parseCsv(await fs.readFile(source, 'utf8'));
  const required = ['流派', '区分', '忍法名', 'タイプ', '指定特技', '間合', 'コスト', 'ページ', '効果要約'];
  const missing = required.filter((header) => !rows[0] || !(header in rows[0]));
  if (missing.length) throw new Error(`CSVに必要な列がありません: ${missing.join('、')}`);

  const [ryuhaResponse, ninpoResponse] = await Promise.all([api('/api/collection?path=ryuha'), api('/api/collection?path=ninpo')]);
  const ryuhaByName = new Map(ryuhaResponse.docs.map((doc) => [doc.data.name, doc]));
  let ryuhaAdded = 0; let ninpoAdded = 0; let skipped = 0;
  for (const ryuhaName of [...new Set(rows.map((row) => row.流派))]) {
    if (!ryuhaByName.has(ryuhaName)) {
      const page = rows.filter((row) => row.流派 === ryuhaName).map((row) => Number(row.ページ)).filter(Number.isFinite).sort((a, b) => a - b)[0];
      const result = await add('ryuha', { name: ryuhaName, strength: '', ougi: '', summary: '', page: page ? String(page) : '', order: ryuhaByName.size + 1 });
      ryuhaByName.set(ryuhaName, { id: result.id, data: { name: ryuhaName } }); ryuhaAdded += 1;
    }
  }
  const existing = new Set(ninpoResponse.docs.map((doc) => key(doc.data.ryuhaId, doc.data.group, doc.data.name, doc.data.type, doc.data.page)));
  for (const row of rows) {
    const ryuha = ryuhaByName.get(row.流派);
    const id = key(ryuha.id, row.区分, row.忍法名, row.タイプ, row.ページ);
    if (existing.has(id)) { skipped += 1; continue; }
    await add('ninpo', { name: row.忍法名, ryuhaId: ryuha.id, group: row.区分, type: row.タイプ, skill: row.指定特技, range: row.間合, cost: row.コスト, rank: '', dmgA: '', dmgS: '', dmgG: '', page: row.ページ, summary: row.効果要約 });
    existing.add(id); ninpoAdded += 1;
  }
  console.log(JSON.stringify({ ryuhaAdded, ninpoAdded, skipped, sourceRows: rows.length }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
