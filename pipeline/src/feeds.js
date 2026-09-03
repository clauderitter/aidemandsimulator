// Watchlist ingestion: RSS/Atom feeds and X posts, deduplicated against a seen-store.
import { P, readJSON, writeJSON, fetchText, log } from './util.js';

const unesc = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const pick = (xml, tag) => { const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml); return m ? m[1] : ''; };
export function parseFeed(xml) {
  const items = [];
  const entries = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const e of entries) {
    const title = unesc(pick(e, 'title'));
    let link = unesc(pick(e, 'link')); if (!link) { const m = /<link[^>]*href="([^"]+)"/i.exec(e); link = m ? m[1] : ''; }
    const date = unesc(pick(e, 'pubDate') || pick(e, 'published') || pick(e, 'updated') || pick(e, 'dc:date'));
    const summary = unesc(pick(e, 'description') || pick(e, 'summary') || pick(e, 'content:encoded') || pick(e, 'content')).slice(0, 600);
    if (title && link) items.push({ title, link, date: date ? new Date(date).toISOString().slice(0, 10) : null, summary });
  }
  return items;
}

// Link scan for sites without a feed: article links under a path prefix, in page order (newest first on most sites).
export function parseLinks(html, base, match) {
  const out = []; const seenHere = new Set(); const re = /<a[^>]+href="([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) { let href = m[1]; const text = unesc(m[2]).slice(0, 160); if (!href.includes(match) || !text || text.length < 12) continue; if (href.startsWith('/')) href = new URL(href, base).toString(); if (seenHere.has(href)) continue; seenHere.add(href); out.push({ title: text, link: href, date: null, summary: '' }); }
  return out;
}
export async function gatherItems(cfg) {
  const seen = readJSON(P('pipeline', 'state', 'seen.json'), {});
  const lookback = cfg.lookback_days || 3; const cutoff = new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10);
  const items = []; const failed = [];
  for (const f of cfg.feeds) {
    try {
      let parsed;
      if (f.kind === 'html') { const html = await fetchText(f.url, { timeout: 20000 }); parsed = parseLinks(html, f.url, f.match).filter(i => !seen[i.link]).slice(0, 6); }
      else { const xml = await fetchText(f.url, { timeout: 20000 }); parsed = parseFeed(xml).filter(i => (!i.date || i.date >= cutoff) && !seen[i.link]).slice(0, 8); }
      for (const i of parsed) items.push({ ...i, feed: f.name }); log('feed', f.name, parsed.length);
    } catch (e) { log('feed fail', f.name, String(e).slice(0, 80)); failed.push({ name: f.name, url: f.url }); }
  }
  const recent = readJSON(P('pipeline', 'state', 'x_recent.json'), []);
  const posts = recent.filter(p => !seen['x:' + p.id]).slice(-80);
  const health = readJSON(P('pipeline', 'state', 'feed_health.json'), []).filter(h => h.date >= new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)); health.push({ date: new Date().toISOString().slice(0, 10), failed: failed.map(f => f.name) }); writeJSON(P('pipeline', 'state', 'feed_health.json'), health);
  return { items: items.slice(0, 30), posts: posts.slice(-60), seen, failed };
}

export function markSeen(seen, items, posts) {
  const now = Date.now();
  for (const i of items) seen[i.link] = now; for (const p of posts) seen['x:' + p.id] = now;
  for (const k of Object.keys(seen)) if (now - seen[k] > 45 * 86400000) delete seen[k];
  writeJSON(P('pipeline', 'state', 'seen.json'), seen);
}
