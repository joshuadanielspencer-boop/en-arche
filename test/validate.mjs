// Content validation for En Archē. No dependencies: extracts the app's
// inline script from index.html, boots it inside a sandboxed VM with DOM
// stubs, and checks every lesson, passage, quiz, card, form, and the pure
// engines (transliteration, canonical compare, scheduler, sync merge).
// Run: node test/validate.mjs   (exits non-zero on any failure)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const failures = [];
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

// ---------- extract and compile the inline script ----------
const m = html.match(/<script>([\s\S]*)<\/script>/);
ok(!!m, 'index.html contains an inline <script> block');
if (!m) finish();

// First: the app's own source must parse exactly as shipped.
try {
  new vm.Script(m[1], { filename: 'en-arche-inline.js' });
} catch (e) {
  failures.push('script does not parse: ' + e.message);
  finish();
}
// Then: re-run with a shim that exposes the top-level bindings
// (const/let in a vm script do not attach to the context global).
const EXPORTS = ['LESSONS', 'PASSAGES', 'SENTENCES', 'CARDS', 'FORMS', 'PARSE_CATS',
  'greekify', 'canonGreek', 'stripMarks', 'typingTargets', 'parseQuestion',
  'interlinearHTML', 'schedule', 'todayStr', 'mergeSync', 'blankProfile', 'DB'];
const script = new vm.Script(
  m[1] + `\n;globalThis.__T = { ${EXPORTS.join(', ')} };`,
  { filename: 'en-arche-inline.js' }
);

// ---------- DOM stubs ----------
function stubEl() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {},
    dataset: {},
    focus() {},
    setSelectionRange() {},
    scrollIntoView() {},
    appendChild() {},
    remove() {},
    click() {},
  };
}
const storage = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById: () => stubEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    documentElement: stubEl(),
    body: stubEl(),
  },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  },
  confirm: () => true,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: class { constructor() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  script.runInContext(sandbox);
} catch (e) {
  failures.push('script failed at boot: ' + e.message);
  finish();
}
const S = sandbox.__T;
ok(S && Array.isArray(S.LESSONS), 'app booted and exposed its data');
if (!S || !Array.isArray(S.LESSONS)) finish();

// ---------- lessons ----------
ok(Array.isArray(S.LESSONS) && S.LESSONS.length >= 29, `LESSONS has ${S.LESSONS?.length} entries (expected >= 29)`);
const ids = new Set();
for (const l of S.LESSONS) {
  ok(l.id && !ids.has(l.id), `lesson id "${l.id}" is present and unique`);
  ids.add(l.id);
  ok(typeof l.title === 'string' && l.title.length > 2, `lesson ${l.id}: has a title`);
  let body = '';
  try { body = l.body(); } catch (e) { failures.push(`lesson ${l.id}: body() threw — ${e.message}`); checks++; }
  ok(typeof body === 'string' && body.length > 200, `lesson ${l.id}: body renders (> 200 chars)`);
  ok(Array.isArray(l.quiz) && l.quiz.length === 5, `lesson ${l.id}: quiz has exactly 5 questions`);
  for (const [qi, q] of (l.quiz || []).entries()) {
    ok(q.q && q.a && Array.isArray(q.wrong) && q.wrong.length === 3,
      `lesson ${l.id} q${qi + 1}: has question, answer, 3 wrong options`);
    ok(new Set([q.a, ...q.wrong]).size === 4,
      `lesson ${l.id} q${qi + 1}: all 4 choices are distinct`);
  }
}
ok(S.LESSONS[S.LESSONS.length - 1].id === 'onward', 'the path ends with the "onward" lesson');

// ---------- passages ----------
const pids = Object.keys(S.PASSAGES);
ok(pids.length >= 9, `PASSAGES has ${pids.length} entries (expected >= 9)`);
for (const pid of pids) {
  const p = S.PASSAGES[pid];
  ok(p.title && p.ref && p.level, `passage ${pid}: has title, ref, level`);
  ok(Array.isArray(p.verses) && p.verses.length > 0, `passage ${pid}: has verses`);
  for (const v of p.verses || []) {
    ok(typeof v.en === 'string' && v.en.length > 5, `passage ${pid} v${v.v}: has an English rendering`);
    ok(Array.isArray(v.words) && v.words.length > 0, `passage ${pid} v${v.v}: has words`);
    for (const w of v.words || []) {
      ok(Array.isArray(w) && w.length === 3 && w.every(x => typeof x === 'string' && x.length),
        `passage ${pid} v${v.v}: word "${w && w[0]}" has [greek, translit, gloss]`);
    }
  }
  let il = '';
  try { il = S.interlinearHTML(pid); } catch (e) { failures.push(`interlinearHTML(${pid}) threw — ${e.message}`); checks++; }
  ok(il.includes('il-word'), `passage ${pid}: interlinear renders`);
}

// ---------- verse drill ----------
ok(Array.isArray(S.SENTENCES) && S.SENTENCES.length >= 20, `SENTENCES has ${S.SENTENCES?.length} (expected >= 20)`);
for (const [i, s] of (S.SENTENCES || []).entries()) {
  ok(s.gk && s.ref && s.en && [1, 2, 3].includes(s.tier), `sentence ${i} (${s.ref}): fields and tier valid`);
}

// ---------- cards ----------
ok(Array.isArray(S.CARDS) && S.CARDS.length >= 99, `CARDS has ${S.CARDS?.length} (expected >= 99)`);
for (const [i, c] of (S.CARDS || []).entries()) {
  ok(c.w && c.g && typeof c.f === 'number' && ['small', 'noun', 'verb'].includes(c.t),
    `card ${i} (${c.w}): fields valid`);
  const targets = S.typingTargets(c.w);
  ok(targets.length >= 1 && targets.every(t => t.length > 0 && !t.startsWith('-')),
    `card ${i} (${c.w}): typing targets valid — got ${JSON.stringify(targets)}`);
}

// ---------- parsing forms ----------
const cats = new Set(S.PARSE_CATS.map(([k]) => k));
ok(Array.isArray(S.FORMS) && S.FORMS.length >= 90, `FORMS has ${S.FORMS?.length} (expected >= 90)`);
for (const [i, f] of (S.FORMS || []).entries()) {
  ok(f.f && f.l && f.p && f.g && cats.has(f.c), `form ${i} (${f.f}): fields and category valid`);
  ok(f.l.includes(' — '), `form ${i} (${f.f}): lemma line has an em-dash gloss`);
  for (const seed of [i, i + 7]) {
    const q = S.parseQuestion(i, seed);
    ok(q.choices.length === 4 && new Set(q.choices).size === 4 && q.choices.includes(q.answer),
      `form ${i} (${f.f}) seed ${seed}: 4 distinct choices including the answer`);
  }
}

// ---------- transliteration & canonical compare ----------
const golden = {
  'lo/gos': 'λόγος', 'a)rch/': 'ἀρχή', 'a)rch=|': 'ἀρχῇ', 'qeo/s': 'θεός',
  'kai/': 'καί', 'yuch/': 'ψυχή', 'e)gw/': 'ἐγώ', 'I)hsou=s': 'Ἰησοῦς',
  'o(': 'ὁ', 'ui(o/s': 'υἱός', 'pneu=ma': 'πνεῦμα', 'logos': 'λογος',
  'a)/nqrwpos': 'ἄνθρωπος', 'fw=s': 'φῶς', 'cristo/s': 'χριστός', 'xe/nos': 'ξένος',
};
for (const [inp, want] of Object.entries(golden)) {
  const got = S.greekify(inp);
  ok(got === want, `greekify("${inp}") = "${got}" (want "${want}")`);
  ok(S.greekify(got) === got, `greekify idempotent on "${got}"`);
}
ok(S.canonGreek(S.greekify('a)/ggelos')) === S.canonGreek(S.greekify('a/)ggelos')),
  'canonGreek: diacritic order does not matter');
ok(S.stripMarks('ἀρχῇ') === 'αρχη', `stripMarks("ἀρχῇ") = "${S.stripMarks('ἀρχῇ')}"`);

// ---------- scheduler ----------
{
  const st = {};
  S.schedule(st, true); ok(st.interval === 1, `schedule: first right -> 1 day (got ${st.interval})`);
  S.schedule(st, true); ok(st.interval === 3, `schedule: second right -> 3 days (got ${st.interval})`);
  S.schedule(st, true); ok(st.interval >= 6, `schedule: third right grows (got ${st.interval})`);
  S.schedule(st, false); ok(st.interval === 0 && st.reps === 0 && st.due === S.todayStr(),
    'schedule: a miss resets to due today');
}

// ---------- sync merge ----------
{
  const now = Date.now();
  S.DB.profiles.MergeTest = Object.assign(S.blankProfile(), { updatedAt: now - 1000 });
  const pulled = S.mergeSync({
    profiles: { MergeTest: Object.assign(S.blankProfile(), { updatedAt: now, daily: { streak: 7, last: null } }) },
    deleted: {},
  });
  ok(pulled === 1 && S.DB.profiles.MergeTest.daily.streak === 7, 'mergeSync: newer remote profile wins');
  S.mergeSync({ profiles: {}, deleted: { MergeTest: now + 1000 } });
  ok(!S.DB.profiles.MergeTest, 'mergeSync: tombstone deletes the profile');
}

finish();

function finish() {
  console.log(`\n${checks - failures.length} / ${checks} checks passed`);
  if (failures.length) {
    console.error('\nFAILURES:');
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('All content and engine checks passed.');
  process.exit(0);
}
