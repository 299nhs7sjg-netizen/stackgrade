import { grade } from '../assets/checks.js';
const domains = process.argv.slice(2);
for (const d of domains) {
  const t0 = Date.now();
  const r = await grade(d);
  const ms = Date.now() - t0;
  if (r.error || r.nonexistent) { console.log(JSON.stringify({ d, ms, error: r.error, nonexistent: r.nonexistent, registered: r.registered })); continue; }
  console.log(`\n### ${d} -> ${r.score} ${r.letter} (coverage ${r.coverage}/100) ${ms}ms groups=${JSON.stringify(Object.fromEntries(Object.entries(r.groups).map(([k,v])=>[k,v.score])))}`);
  for (const c of r.checks) console.log(`  [${c.status}] ${c.id}: ${c.summary}${c.value ? ' | ' + c.value.slice(0,120).replace(/\n/g,' ') : ''}`);
  console.log('  tech:', (r.tech||[]).map(t=>t.name).join(', '));
}
