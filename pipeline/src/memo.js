// Weekly model review: a memo on where the week's evidence outgrew the model's structure, filed as a GitHub issue.
import fs from 'node:fs';
import { P, readJSON, writeJSON, today, log } from './util.js';
import { runAgent } from './llm.js';
import { RULES } from './rulesets.js';
import { simulate, resolveEvents, paramsOf } from '../../site/model.js';

const MEMO_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] },
  summary: { type: 'string', description: 'two or three sentences' },
  items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    area: { type: 'string', enum: ['structure', 'inputs', 'rules', 'scenarios', 'data', 'sources'] },
    finding: { type: 'string' }, evidence: { type: 'string' }, suggestion: { type: 'string' }, effect: { type: 'string' } },
    required: ['area', 'finding', 'evidence', 'suggestion', 'effect'] } } },
  required: ['title', 'priority', 'summary', 'items'] };

function weekDigest(state, changelog) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const week = changelog.filter(c => c.date >= cutoff);
  const lines = week.map(c => `${c.date} ${c.kind} ${c.target}: ${c.old ?? ''} → ${c.new ?? ''} — ${(c.reason || '').slice(0, 220)}`);
  const capped = week.filter(c => c.capped).map(c => `${c.target}: moved ${c.old} → ${c.new}, target ${c.target_value}`);
  const pending = Object.entries(state.params).filter(([k, p]) => p.pending_target != null).map(([k, p]) => `${k}: at ${p.value}, target ${p.pending_target} since ${p.pending_since}`);
  const A = [4, 8, 12, 17]; const act = state.scenarios.filter(x => x.status !== 'retired'); const paths = Object.fromEntries(act.map(x => [x.id, simulate(paramsOf(state, x.p || {}), resolveEvents((x.e || []).filter(e => !e.expired), state.quarter0), null, state.horizon_quarters).map(r => r.revenue)]));
  const gap = (a, b) => Math.max(...A.map(t => Math.abs(a[t] - b[t]) / Math.max(a[t], b[t], 1e-9)));
  const close = []; for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) { const g = gap(paths[act[i].id], paths[act[j].id]); if (g < 0.15) close.push(`${act[i].id} vs ${act[j].id}: ${Math.round(g * 100)}%`); }
  const stale = state.gauges.filter(g => (Date.now() - new Date(g.as_of)) / 86400000 > 45).map(g => `${g.id} (as of ${g.as_of})`);
  const params = Object.entries(state.params).filter(([k, p]) => !p.hidden).map(([k, p]) => `${k} = ${p.value} (${p.type}, as of ${p.as_of}; rules: ${(RULES[k] || []).join(', ') || 'none'})`);
  const scen = state.scenarios.filter(s => s.status !== 'retired').map(s => `${s.id} [${s.camp}${s.core ? ', core' : ', rotating'}] ${s.name} — ${s.who}${s.added ? ' (added ' + s.added + ')' : ''}`);
  const retired = state.scenarios.filter(s => s.status === 'retired').map(s => `${s.id}: ${s.retired_reason || ''}`);
  const notes = readJSON(P('pipeline', 'state', 'notes.json'), []).filter(n => n.date >= cutoff).flatMap(n => n.notes.map(x => `${n.date}: ${x}`));
  const health = readJSON(P('pipeline', 'state', 'feed_health.json'), []).filter(h => h.date >= cutoff).map(h => `${h.date}: failed ${h.failed.join(', ') || 'none'}`);
  return { lines, capped, stale, params, scen, retired, notes, health, pending, close };
}

async function github(path, method = 'GET', body = null) {
  const token = process.env.GITHUB_TOKEN; const repo = process.env.GITHUB_REPOSITORY || 'clauderitter/aidemandsimulator';
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'aidemandsimulator-pipeline' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok && res.status !== 422) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 422 ? null : res.json();
}

export async function memo(state, cfg, changelog) {
  const d = weekDigest(state, changelog);
  const modelDoc = fs.readFileSync(P('pipeline', 'config', 'model.md'), 'utf8'); const rules = fs.readFileSync(P('pipeline', 'config', 'rules.md'), 'utf8');
  const system = `You are the weekly reviewer of a self-updating scenario model of frontier-AI token demand versus compute supply. Inputs are updated daily by collectors and a researcher/judge pair under fixed rules; the model's structure only changes through a human commit. Your memo goes to the maintainer as a GitHub issue.
Write for a reader who knows the model. Say where this week's evidence does not fit the structure (a mechanism the model lacks, a parameter that keeps hitting its speed limit, a rule that keeps rejecting the same kind of evidence, a derived rule that has become a tautology), which inputs are drifting or stale, whether the scenario set is healthy (rotating-slot churn, near-duplicates, a camp with no live view, a proponent who has changed position), and any data plumbing that is failing. For each item give the evidence, a concrete suggested change and its expected effect on outputs. Prefer few, specific items; say "nothing to report" for areas that are fine. No flattery, no restating the model. Call submit_memo exactly once.

## Model
${modelDoc}

## Rulebook
${rules}`;
  const user = `Week ending ${today()}. Quarter zero ${state.quarter0}.

## Inputs
${d.params.join('\n')}

## Changelog this week (${d.lines.length} entries)
${d.lines.join('\n') || 'none'}

## Parameters that hit a speed limit this week (target carries over automatically)
${d.capped.join('\n') || 'none'}

## Still moving toward a capped target
${d.pending.join('\n') || 'none'}

## Scenario pairs within 15% of each other at every anchor (path similarity, not view similarity)
${d.close.join('\n') || 'none'}

## Stale gauges (>45 days)
${d.stale.join('\n') || 'none'}

## Active scenarios
${d.scen.join('\n')}

## Retired scenarios
${d.retired.join('\n') || 'none'}

## Researcher notes this week (things seen but not proposed)
${d.notes.join('\n') || 'none recorded'}

## Feed health
${d.health.join('\n') || 'no record'}`;
  const tools = [{ name: 'submit_memo', description: 'Submit the weekly memo.', strict: true, input_schema: MEMO_SCHEMA }];
  const mock = () => ({ title: 'Weekly model review (mock)', priority: 'low', summary: 'Mock memo.', items: [{ area: 'data', finding: 'mock', evidence: 'mock', suggestion: 'mock', effect: 'none' }] });
  const m = await runAgent({ system, user, tools, submitTool: 'submit_memo', maxIters: 3, effort: 'high', mock });
  if (!m) { log('memo: no output'); return null; }
  const title = `Weekly model review — ${today()}`;
  const body = `**Priority: ${m.priority}**\n\n${m.summary}\n\n` + m.items.map(it => `### ${it.area}: ${it.finding}\n- **Evidence:** ${it.evidence}\n- **Suggestion:** ${it.suggestion}\n- **Expected effect:** ${it.effect}`).join('\n\n') + `\n\n---\nFiled automatically by the pipeline. Context: [changelog](https://github.com/${process.env.GITHUB_REPOSITORY || 'clauderitter/aidemandsimulator'}/blob/main/site/data/changelog.json) · [live site](https://www.aidemandsimulator.com/). Inputs move on their own under the rulebook; anything here needs a commit.`;
  fs.mkdirSync(P('pipeline', 'state', 'memos'), { recursive: true }); fs.writeFileSync(P('pipeline', 'state', 'memos', `${today()}.md`), `# ${title}\n\n${body}\n`);
  if (process.env.MEMO_DRY === '1' || !process.env.GITHUB_TOKEN) { log('memo: dry run, not filed'); return { title, body, filed: false }; }
  await github('/labels', 'POST', { name: 'model-review', color: '5b6570', description: 'Weekly review memo from the pipeline' });
  const open = await github('/issues?labels=model-review&state=open&per_page=50');
  if ((open || []).some(i => i.title === title)) { log('memo: already filed today'); return { title, filed: false }; }
  const issue = await github('/issues', 'POST', { title, body, labels: ['model-review'] });
  log('memo filed:', issue && issue.html_url);
  return { title, filed: true, url: issue && issue.html_url };
}
