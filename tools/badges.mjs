// Re-grade every domain in domains.json and write badge/<domain>.svg, badge/<domain>.json and badge/index.json.
// Usage: node tools/badges.mjs            (re-grade all)
//        node tools/badges.mjs --add example.com   (grade now; list it only if it scores B or better)
import fs from 'node:fs';
import path from 'node:path';
import { grade, parseInput, toUnicode } from '../assets/checks.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const LIST = path.join(ROOT, 'domains.json');
const OUT = path.join(ROOT, 'badge');
const RANK = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const COLOR = { A: '#16a34a', B: '#65a30d', grey: '#9ca3af' };

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Approximate Verdana 11px widths; textLength keeps rendering exact regardless of font.
const tw = (s) => Math.ceil([...s].reduce((w, c) => w + (/[ilj.,:;|!'1]/.test(c) ? 3.6 : /[mwMW]/.test(c) ? 10 : /[A-Z0-9]/.test(c) ? 7.6 : c === ' ' ? 3.6 : 6.6), 0));

export function badgeSvg({ right, color, title }) {
    const left = 'StackGrade';
    const lw = tw(left) + 20; const rw = tw(right) + 20; const W = lw + rw;
    const id = `sg${W}${color.replace(/[^0-9a-f]/gi, '')}${right.length}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title>
<linearGradient id="${id}s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="${id}r"><rect width="${W}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#${id}r)"><rect width="${lw}" height="20" fill="#0f172a"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/><rect width="${W}" height="20" fill="url(#${id}s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
<text x="${lw * 5}" y="140" transform="scale(.1)" textLength="${(lw - 20) * 10}">${xml(left)}</text>
<text x="${(lw + rw / 2) * 10}" y="140" transform="scale(.1)" textLength="${(rw - 20) * 10}">${xml(right)}</text></g></svg>
`;
}

export function badgeState(entry, rep) {
    const checkedAt = new Date().toISOString();
    const date = checkedAt.slice(0, 10);
    const base = { domain: entry.domain, claim: entry.claim, checkedAt, reportUrl: `${SITE}?d=${encodeURIComponent(toUnicode(entry.domain))}` };
    if (!rep || rep.error || rep.nonexistent || rep.score == null) return { ...base, status: 'unverified', reason: rep?.error || (rep?.nonexistent ? 'domain does not exist' : 'grade unavailable'), letter: null, score: null, coverage: 0, svg: { right: `not verified · ${date}`, color: COLOR.grey } };
    const st = { ...base, letter: rep.letter, score: rep.score, coverage: rep.coverage, groups: Object.fromEntries(Object.entries(rep.groups).map(([k, v]) => [k, v.score])) };
    if (rep.coverage < 70) return { ...st, status: 'unverified', reason: `only ${rep.coverage} of 100 points could be checked`, svg: { right: `not verified · ${date}`, color: COLOR.grey } };
    if (RANK[rep.letter] < RANK[entry.claim]) return { ...st, status: 'below-claim', reason: `grade ${rep.letter} is below the claimed ${entry.claim}`, svg: { right: `below ${entry.claim} · ${date}`, color: COLOR.grey } };
    return { ...st, status: 'verified', svg: { right: `Graded ${entry.claim} · ${date}`, color: COLOR[entry.claim] } };
}

async function main() {
    const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
    const addIdx = process.argv.indexOf('--add');
    if (addIdx > 0) {
        const p = parseInput(process.argv[addIdx + 1]);
        if (p.error) throw new Error(p.error);
        if (list.some((x) => x.domain === p.domain)) { console.log('already listed'); return; }
        const rep = await grade(p.domain);
        if (rep.error || rep.score == null || rep.coverage < 70 || RANK[rep.letter] < RANK.B) { console.log(`not eligible: ${rep.error || `${rep.letter} ${rep.score} coverage ${rep.coverage}`}`); process.exitCode = 2; return; }
        list.push({ domain: p.domain, claim: rep.letter, addedAt: new Date().toISOString().slice(0, 10) });
        fs.writeFileSync(LIST, JSON.stringify(list, null, 2) + '\n');
        console.log(`added ${p.domain} with claim ${rep.letter} (${rep.score})`);
    }
    fs.mkdirSync(OUT, { recursive: true });
    const index = [];
    const queue = [...list];
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length) {
            const entry = queue.shift();
            const rep = await grade(entry.domain).catch((e) => ({ error: e.message }));
            const st = badgeState(entry, rep);
            const title = `StackGrade: ${toUnicode(entry.domain)} ${st.status === 'verified' ? `graded ${st.letter} (${st.score}/100)` : st.reason}, checked ${st.checkedAt.slice(0, 10)}`;
            fs.writeFileSync(path.join(OUT, `${entry.domain}.svg`), badgeSvg({ ...st.svg, title }));
            const { svg, ...json } = st;
            fs.writeFileSync(path.join(OUT, `${entry.domain}.json`), JSON.stringify(json, null, 2) + '\n');
            index.push(json);
            console.log(entry.domain, st.status, st.letter, st.score, st.coverage);
        }
    }));
    index.sort((a, b) => a.domain.localeCompare(b.domain));
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
