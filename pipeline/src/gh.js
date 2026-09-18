// GitHub API helper and pipeline alerts. Alerts are issues labelled pipeline-alert: opened on the first failure of a
// streak, commented on at most once a day while it lasts, and closed automatically when the agents run again.
import { log, today } from './util.js';

export async function github(path, method = 'GET', body = null) {
  const token = process.env.GITHUB_TOKEN; const repo = process.env.GITHUB_REPOSITORY || 'clauderitter/aidemandsimulator';
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'aidemandsimulator-pipeline' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok && res.status !== 422) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 422 ? null : res.json();
}

export function classify(err) {
  const m = String(err && err.message || err);
  if (/credit balance is too low|billing/i.test(m)) return { kind: 'billing', fix: 'Top up the Anthropic API credit balance (Console → Plans & Billing) or enable auto-reload. The collectors keep running; the researcher, judge and weekly memo are off until then.' };
  if (/401|403|authentication|permission|workspace/i.test(m)) return { kind: 'auth', fix: 'Check the ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID repository secrets.' };
  if (/429|rate limit|overloaded|529/i.test(m)) return { kind: 'capacity', fix: 'Transient API capacity or rate limit; no action unless it repeats for several days.' };
  return { kind: 'error', fix: 'See the run log for the stack trace.' };
}

export async function raiseAlert(stage, err) {
  if (!process.env.GITHUB_TOKEN || process.env.AGENTS_MOCK === '1') return null;
  const c = classify(err); const title = `Pipeline alert: agents not running (${c.kind})`;
  const body = `The ${stage} stage failed on ${today()}.\n\n**What happened:** \`${String(err && err.message || err).slice(0, 400)}\`\n\n**What to do:** ${c.fix}\n\nCollector data (rates, VIX, Polymarket, METR, Epoch) is still being committed daily. This issue closes itself on the next run in which the agents work.`;
  try {
    await github('/labels', 'POST', { name: 'pipeline-alert', color: 'c62828', description: 'The autonomous pipeline needs attention' });
    const open = (await github('/issues?labels=pipeline-alert&state=open&per_page=20')) || [];
    if (open.length) { const last = new Date(open[0].updated_at).toISOString().slice(0, 10); if (last !== today()) await github(`/issues/${open[0].number}/comments`, 'POST', { body: `Still failing on ${today()}: \`${String(err && err.message || err).slice(0, 300)}\`` }); return open[0].html_url; }
    const issue = await github('/issues', 'POST', { title, body, labels: ['pipeline-alert'] }); log('alert filed:', issue && issue.html_url); return issue && issue.html_url;
  } catch (e) { log('alert could not be filed:', String(e).slice(0, 160)); return null; }
}

export async function clearAlerts() {
  if (!process.env.GITHUB_TOKEN || process.env.AGENTS_MOCK === '1') return;
  try { const open = (await github('/issues?labels=pipeline-alert&state=open&per_page=20')) || []; for (const i of open) { await github(`/issues/${i.number}/comments`, 'POST', { body: `Recovered on ${today()}: the agents ran normally.` }); await github(`/issues/${i.number}`, 'PATCH', { state: 'closed' }); log('alert closed:', i.number); } } catch (e) { log('alert clear failed:', String(e).slice(0, 120)); }
}
