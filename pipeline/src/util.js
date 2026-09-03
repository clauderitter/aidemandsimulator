import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const P = (...p) => path.join(ROOT, ...p);
export const readJSON = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
export const writeJSON = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); };
export const today = () => new Date().toISOString().slice(0, 10);
export async function fetchText(url, opts = {}) {
  const res = await fetch(url, { headers: { 'user-agent': 'aidemandsimulator-pipeline/0.1 (+https://github.com/clauderitter/aidemandsimulator)', ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
export const round = (v, step) => Math.round(v / step) * step;
export function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
// Minimal RFC4180 CSV parser (handles quoted fields with commas and newlines).
export function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
export function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }
