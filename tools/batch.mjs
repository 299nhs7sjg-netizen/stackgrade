import { grade } from '../assets/checks.js';
const domains = process.argv.slice(2);
const out = await Promise.all(domains.map(async (d) => { const t0 = Date.now(); const r = await grade(d, {}); return { d, r, ms: Date.now() - t0 }; }));
for (const { d, r, ms } of out) {
  if (r.error || r.nonexistent) { console.log(`\n### ${d} -> ${JSON.stringify({ error: r.error, nonexistent: r.nonexistent, registered: r.registered })}`); continue; }
  console.log(`\n### ${d} -> ${r.score} ${r.letter} (coverage ${r.coverage}/100) ${ms}ms groups=${JSON.stringify(Object.fromEntries(Object.entries(r.groups).map(([k,v])=>[k,v.score])))}`);
  for (const c of r.checks) console.log(`  [${c.status}] ${c.id}: ${c.summary}${c.value ? ' | ' + c.value.slice(0,140).replace(/\n/g,' ') : ''}`);
  console.log('  tech:', (r.tech||[]).map(t=>t.name).join(', '));
}
