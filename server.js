/**
 * JR SQA Scheduler Server — FINAL+AUTO
 * ------------------------------------
 * Fitur:
 * 1) Scheduler Playwright (global) + logs & report:
 *    - POST /run
 *    - POST /start?mode=minutes|hours&value=N
 *    - POST /stop
 *    - GET  /status
 *    - GET  /logs
 *    - static /playwright-report
 *    - static /test-results (trace.zip, screenshot, video)
 *    - GET  /pw/summary  → ringkasan test gagal + link artifacts
 *
 * 2) Health-check per website + dedicated logs:
 *    - GET  /site/list
 *    - POST /site/check?site={key}
 *    - POST /site/check-all
 *    - GET  /site/status?site={key}
 *    - GET  /site/logs?site={key}
 *
 * 3) Sinkronisasi: selesai Playwright run → otomatis check-all situs (dedicated log auto update)
 *
 * Jalankan:
 *   npm i -D express playwright @playwright/test
 *   npx playwright install
 *   node server.js
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const REPORT_DIR = path.join(ROOT, 'playwright-report');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEST_RESULTS_DIR = path.join(ROOT, 'test-results');

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/playwright-report', express.static(REPORT_DIR));
app.use('/test-results', express.static(TEST_RESULTS_DIR));

// Melayani file dari folder .playwright-artifacts-* (hanya folder yang aman itu)
app.get('/artifacts/:dir/*', (req, res) => {
  const dir = req.params.dir;          // ex: .playwright-artifacts-4
  const rest = req.params[0] || '';    // path file di dalamnya
  // hanya izinkan pola .playwright-artifacts-<angka>
  if (!/^\.(playwright-)?artifacts-\d+$/i.test(dir)) return res.status(404).end('Not found');

  const base = path.join(ROOT, dir);
  const abs  = path.join(base, rest);

  // cegah path traversal
  if (!abs.startsWith(base)) return res.status(403).end('Forbidden');

  fs.access(abs, fs.constants.R_OK, (err) => {
    if (err) return res.status(404).end('Not found');
    res.sendFile(abs);
  });
});


// =====================[ Daftar situs dipantau ]=====================
const SITES = {
  wbs: {
    name: 'WBS Jasa Raharja',
    base: 'https://wbs.jasaraharja.co.id',
    checks: [
      { label: 'Home', path: '/', expect: { ok: [200] } },
      { label: 'Login', path: '/login', expect: { ok: [200, 302] } },
      { label: 'Register', path: '/register', expect: { ok: [200, 302] } },
      { label: 'Tambah Laporan', path: '/laporan/tambah', expect: { ok: [200, 302] } },
      { label: 'Manual (PDF)', path: '/page/manual', expect: { ok: [200, 206], contentType: /pdf|octet-stream/i, minBytes: 10_000 } },
      { label: 'Proteksi Laporan Saya (/laporan/detail)', path: '/laporan/detail', expect: { ok: [200, 302] } },

    ],
  },
   spjr: {
    name: 'SP Jasa Raharja',
    base: 'https://sp-jasaraharja.id',
    checks: [
      { label: 'Home', path: '/', expect: { ok: [200] } },
      { label: 'All News', path: '/all-news', expect: { ok: [200] } },
      { label: 'Sejarah', path: '/sejarah', expect: { ok: [200] } },
      { label: 'Visi Misi', path: '/visi-misi', expect: { ok: [200] } },
      { label: 'Struktur', path: '/struktur', expect: { ok: [200] } },
      { label: 'Tugas & Fungsi', path: '/tugas-fungsi', expect: { ok: [200] } },
      { label: 'Laporan', path: '/laporan', expect: { ok: [200] } },
      { label: 'Panduan', path: '/panduan', expect: { ok: [200] } },
    ],
  },
  wiki: {
    name: 'Wikipedia (contoh)',
    base: 'https://www.wikipedia.org',
    checks: [
      { label: 'Home', path: '/', expect: { ok: [200] } },
      { label: 'Search (redirect)', path: '/search-redirect.php?search=playwright', expect: { ok: [200, 302] } },
    ],
  },


};
  // 🔽 Tambahin ini setelah SITES
const PROJECT_LABELS = {
  jr: "WBS Jasa Raharja",
  spjr: "SP Jasa Raharja"
};


// =====================[ Utils HTTP ]=====================
async function fetchWithTimeout(url, { timeoutMs = 12_000, ...opts } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, ...opts });
    return res;
  } finally { clearTimeout(t); }
}

// =====================[ State: per-site ]================
const siteLogs = Object.fromEntries(Object.keys(SITES).map(k => [k, []]));
const siteStatus = Object.fromEntries(Object.keys(SITES).map(k => [k, null]));
// Tambahkan di atas (global)


async function checkOneSite(siteKey) {
  const conf = SITES[siteKey];
  if (!conf) throw new Error('Site tidak dikenali');

  const items = [];
  let allOk = true;

  for (const c of conf.checks) {
    const url = conf.base.replace(/\/$/, '') + c.path;
    let passed = false, note = '', http = 0, ctype = '', bytes = 0;

    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 15_000 });
      http = res.status;
      ctype = res.headers.get('content-type') || '';
      if (c.expect?.contentType || c.expect?.minBytes) {
        const buf = new Uint8Array(await res.arrayBuffer());
        bytes = buf.byteLength;
      }
      const expect = c.expect || {};
      const okList = expect.ok || [200];
      passed =
        okList.includes(http) &&
        (!expect.contentType || expect.contentType.test(ctype)) &&
        (!expect.minBytes || bytes >= expect.minBytes);

      if (!passed) {
        const conds = [
          `HTTP in ${okList.join(',')}`,
          expect.contentType ? `CT ~ ${expect.contentType}` : null,
          expect.minBytes ? `>= ${expect.minBytes} bytes` : null,
        ].filter(Boolean).join(' & ');
        note = `Butuh: ${conds}`;
      }
    } catch (e) {
      note = e.name === 'AbortError' ? 'Timeout' : (e?.message || 'Error');
      passed = false;
    }

    items.push({ label: c.label, url, http, contentType: ctype || null, bytes: bytes || null, ok: passed, note: note || null });
    if (!passed) allOk = false;
  }

  const summary = { site: siteKey, name: conf.name, base: conf.base, ok: allOk, items, ts: new Date().toISOString() };
  siteStatus[siteKey] = summary;
  siteLogs[siteKey].push(summary);
  if (siteLogs[siteKey].length > 30) siteLogs[siteKey] = siteLogs[siteKey].slice(-30);
  return summary;
}

async function checkAllSitesSilent() {
  const keys = Object.keys(SITES);
  for (const k of keys) {
    try { await checkOneSite(k); } catch (e) { /* diamkan */ }
  }
}

// =====================[ Scheduler Playwright ]================
let timer = null;
let schedule = { mode: null, value: null, ms: null };
let lastRun = { startedAt: null, endedAt: null, exitCode: null, durationMs: null };
let running = false;
let wantAnotherRun = false;
let logBuf = '';

const appendLog = (chunk) => {
  const s = String(chunk || '');
  logBuf += s;
  if (logBuf.length > 8000) logBuf = logBuf.slice(-8000);
};

function resolvePlaywrightBin() {
  const isWin = process.platform === 'win32';
  const binWin = path.join(ROOT, 'node_modules', '.bin', 'playwright.cmd');
  const binNix = path.join(ROOT, 'node_modules', '.bin', 'playwright');

  if (isWin && fs.existsSync(binWin)) return { type: 'win-cmd', cmd: binWin };
  if (!isWin && fs.existsSync(binNix)) return { type: 'nix-bin', cmd: binNix };

  try { return { type: 'node-cli', cmd: require.resolve('playwright/cli') }; } catch {}
  try { return { type: 'node-cli', cmd: require.resolve('@playwright/test/cli') }; } catch {}
  return null;
}

function spawnPlaywright(args) {
  const resolved = resolvePlaywrightBin();
  if (!resolved) {
    const msg = 'Playwright CLI tidak ditemukan. Jalankan: npm i -D playwright @playwright/test';
    appendLog('\n' + msg + '\n');
    console.error(msg);
    return null;
  }
  const isWin = process.platform === 'win32';

  if (resolved.type === 'win-cmd') {
    const cmdExe = process.env.COMSPEC || 'cmd.exe';
    const q = (v) => (/[\s"]/).test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
    const line = [q(resolved.cmd), ...args.map(q)].join(' ');
    return spawn(cmdExe, ['/d', '/s', '/c', line], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: true,
    });
  }
  if (resolved.type === 'nix-bin') {
    return spawn(resolved.cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  if (resolved.type === 'node-cli') {
    return spawn(process.execPath, [resolved.cmd, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return null;
}

async function runPlaywrightOnce() {
  if (running) { wantAnotherRun = true; return; }
  const pw = spawnPlaywright(['test', '--project=jr', '--project=spjr']);
  if (!pw) return;

  running = true; wantAnotherRun = false;
  lastRun.startedAt = new Date().toISOString();
  lastRun.endedAt = null; lastRun.exitCode = null; lastRun.durationMs = null;
  appendLog(`\n==== Run started at ${lastRun.startedAt} ====\n`);

  const startTs = Date.now();
  pw.stdout.on('data', (d) => appendLog(d));
  pw.stderr.on('data', (d) => appendLog(d));

  await new Promise((resolve) => {
    pw.on('close', async (code) => {
      lastRun.endedAt = new Date().toISOString();
      lastRun.exitCode = code;
      lastRun.durationMs = Date.now() - startTs;
      appendLog(`\n==== Run ended at ${lastRun.endedAt} with code ${code} (duration ${lastRun.durationMs} ms) ====\n`);

      // >>> Sinkronisasi: selesai run → cek semua situs (dedicated log auto update)
      try { await checkAllSitesSilent(); } catch {}

      resolve();
    });
  });

  running = false;
  if (wantAnotherRun) { wantAnotherRun = false; setTimeout(runPlaywrightOnce, 250); }
}

async function scheduleRunner() {
  if (!schedule.mode || !schedule.value) return;
  const n = Number(schedule.value);
  if (!n || n <= 0) return;
  const ms = schedule.mode === 'minutes' ? n * 60 * 1000 : n * 60 * 60 * 1000;
  schedule.ms = ms;

  if (timer) clearTimeout(timer);

  const loop = async () => {
    await runPlaywrightOnce();
    timer = setTimeout(loop, ms);
  };
  loop();
}


// =====================[ API: Playwright global ]================
app.post('/run', (_req, res) => { runPlaywrightOnce(); res.json({ ok: true, queued: running }); });



app.post('/start', (req, res) => {
  const { mode, value } = req.query;
  if (!mode || !value || !['minutes', 'hours'].includes(mode)) {
    return res.status(400).json({ ok: false, msg: 'Gunakan ?mode=minutes|hours&value=angka' });
  }
  schedule = { mode, value: Number(value), ms: null };
  scheduleRunner();
  res.json({ ok: true, schedule });
});

app.post('/stop', (_req, res) => {
  if (timer) clearInterval(timer);
  timer = null; schedule = { mode: null, value: null, ms: null };
  res.json({ ok: true });
});

app.get('/status', (_req, res) => {
  res.json({ running, schedule, lastRun, reportHtml: '/playwright-report/index.html', reportJson: '/playwright-report/data/report.json' });
});

app.get('/logs', (_req, res) => { res.type('text/plain').send(logBuf || 'No logs yet.'); });

// =====================[ API: Per-URL Health ]================
app.get('/site/list', (_req, res) => {
  const list = Object.entries(SITES).map(([k, v]) => ({ key: k, name: v.name, base: v.base, checks: v.checks.map(c => c.label) }));
  res.json({ ok: true, sites: list });
});

app.post('/site/check', async (req, res) => {
  const key = String(req.query.site || '').trim();
  if (!key || !SITES[key]) return res.status(400).json({ ok: false, msg: 'site tidak valid' });
  try { res.json({ ok: true, result: await checkOneSite(key) }); }
  catch (e) { res.status(500).json({ ok: false, msg: e?.message || 'error' }); }
});

app.post('/site/check-all', async (_req, res) => {
  const keys = Object.keys(SITES);
  const results = [];
  for (const k of keys) {
    try { results.push(await checkOneSite(k)); }
    catch (e) { results.push({ site: k, ok: false, error: e?.message || 'error', ts: new Date().toISOString() }); }
  }
  res.json({ ok: true, results });
});

app.get('/site/status', (req, res) => {
  const key = String(req.query.site || '').trim();
  if (!key || !SITES[key]) return res.status(400).json({ ok: false, msg: 'site tidak valid' });
  res.json({ ok: true, status: siteStatus[key] });
});

app.get('/site/logs', (req, res) => {
  const key = String(req.query.site || '').trim();
  if (!key || !SITES[key]) return res.status(400).json({ ok: false, msg: 'site tidak valid' });
  res.json({ ok: true, logs: siteLogs[key] || [] });
});

// =====================[ API: Ringkasan Gagal ]================
function readIfExists(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
}
function guessHref(p) {
  if (!p) return null;
  const norm = String(p).replace(/\\/g, '/');

  // 1) test-results → /test-results/...
  const i = norm.toLowerCase().indexOf('/test-results/');
  if (i >= 0) return '/test-results/' + norm.slice(i + '/test-results/'.length);

  // 2) playwright-report → /playwright-report/...
  const j = norm.toLowerCase().indexOf('/playwright-report/');
  if (j >= 0) return '/playwright-report/' + norm.slice(j + '/playwright-report/'.length);

  // 3) .playwright-artifacts-* di root project → /artifacts/.playwright-artifacts-*/...
  const k = norm.toLowerCase().indexOf('/.playwright-artifacts-');
  if (k >= 0) return '/artifacts' + norm.slice(k);

  // 4) Kalau path absolut Windows (E:\...) yang langsung ke folder artifacts
  const nameOnly = norm.split('/').find(seg => /^\.playwright-artifacts-\d+$/i.test(seg));
  if (nameOnly) {
    const after = norm.split(nameOnly)[1].replace(/^\/+/, '');
    return `/artifacts/${nameOnly}/${after}`;
  }

  return null;
}


// Walk semua bentuk report (v1/v2)
function collectFailuresFromReport(obj) {
  const failures = [];
  const summary = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };

  // counter dari stats kalau ada
  if (obj?.stats) {
    const s = obj.stats;
    summary.total   = Number(s.tests ?? s.total ?? 0);
    summary.passed  = Number(s.passes ?? s.passed ?? 0);
    summary.failed  = Number(s.failures ?? s.failed ?? 0);
    summary.skipped = Number(s.skipped ?? 0);
    summary.flaky   = Number(s.flaky ?? 0);
  }

const pushFail = (t, r) => {
  const title   = t.title || (t.titlePath && t.titlePath.join(' › ')) || '';
  let file    = t.location?.file || t.file || r?.error?.location?.file || null;
  let line    = t.location?.line || t.line || r?.error?.location?.line || null;

  // 🔑 ambil project dengan fallback
  let project = t.projectName || t.project || r?.projectName || '';
  if (!project && file) {
    const low = file.toLowerCase();
    if (low.includes('tests/jr/')) project = 'jr';
    else if (low.includes('tests\\jr\\')) project = 'jr';       // Windows path
    else if (low.includes('tests/spjr/')) project = 'spjr';
    else if (low.includes('tests\\spjr\\')) project = 'spjr';
  }

  const err = (r?.error && (r.error.message || r.error.stack)) || (t.errors && t.errors[0]) || '';
  const atts = (r?.attachments || t.attachments || []).map(a => {
    const href = guessHref(a.path || a.href || '');
    const ct   = (a.contentType || '').toLowerCase();
    let kind = 'file';
    if (/zip/.test(ct) || /trace/.test((a.name||'')+(a.path||''))) kind = 'trace';
    else if (/png/.test(ct)) kind = 'screenshot';
    else if (/webm|mp4/.test(ct)) kind = 'video';
    return href ? { name: a.name || kind, kind, href } : null;
  }).filter(Boolean);

  failures.push({ title, file, line, project, error: err, attachments: atts });
};




  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.suites)) node.suites.forEach(walk);
    if (Array.isArray(node.tests)) {
      node.tests.forEach(t => {
        // total kalau stats tidak ada
        if (!obj?.stats) {
          (t.results || []).forEach(r => {
            summary.total++;
            const st = r.status || r.outcome;
            if (st === 'passed') summary.passed++;
            else if (st === 'failed') summary.failed++;
            else if (st === 'skipped') summary.skipped++;
            else if (st === 'flaky') summary.flaky++;
          });
        }
        (t.results || []).forEach(r => { if ((r.status || r.outcome) === 'failed') pushFail(t, r); });
      });
    }
  };

  if (obj?.suites) walk(obj);
  else if (obj?.report?.suites) walk(obj.report);

  // Beberapa reporter meletakkan error di obj.errors
  if (Array.isArray(obj?.errors)) {
    obj.errors.forEach(e => {
      failures.push({
        title: e?.message?.split('\n')[0] || 'Test Failure',
        file: e?.location?.file, line: e?.location?.line, project: e?.project || '',
        error: e?.stack || e?.message || '',
        attachments: []
      });
      summary.failed++;
      summary.total++;
    });
  }

  return { failures, summary };
}

// Fallback: scan test-results untuk trace/screenshot/video
function scanFailuresFromTestResults(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const dirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const d of dirs) {
    const testDir = path.join(rootDir, d.name);
    const files = [];
    (function walk(p, depth=0){
      if (depth > 3) return;
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const fp = path.join(p, e.name);
        if (e.isDirectory()) walk(fp, depth+1);
        else files.push(fp);
      }
    })(testDir);

    const atts = [];
    for (const f of files) {
      const low = f.toLowerCase();
      if (low.includes('trace') && low.endsWith('.zip')) atts.push({ kind:'trace', href: guessHref(f) });
      else if (low.endsWith('.png')) atts.push({ kind:'screenshot', href: guessHref(f) });
      else if (low.endsWith('.webm') || low.endsWith('.mp4')) atts.push({ kind:'video', href: guessHref(f) });
    }
    if (!atts.length) continue;

    // coba tarik judul dari error-context.md
    let title = d.name;
    const ctx = files.find(p => p.toLowerCase().endsWith('error-context.md'));
    if (ctx) {
      try {
        const txt = fs.readFileSync(ctx, 'utf8');
        const m = txt.match(/›\s*(.+?)\s*$/m);
        if (m) title = m[1];
      } catch {}
    }
    out.push({ title, file:null, line:null, project:null, error:null, attachments: atts });
  }
  return out;
}

// Fallback tambahan: parse judul gagal langsung dari log teks
function parseFailuresFromLogs(txt) {
  const out = [];
  if (!txt) return out;
  const re = /^\s*\d+\)\s*\[([^\]]+)\]\s*›\s*([^\n]+?)\s*›\s*(.+)$/gm;
  let m;
  while ((m = re.exec(txt))) {
    const project = m[1];
    const fileLine = m[2];
    const title = m[3];
    let file=null, line=null;
    const ml = fileLine.match(/:(\d+):\d+\s*$/);
    if (ml) { line = Number(ml[1]); }
    file = fileLine.replace(/:\d+:\d+\s*$/,'');
    out.push({ title, file, line, project, error: null, attachments: [] });
  }
  return out;
}

app.get('/pw/summary', (_req, res) => {
  const p1 = path.join(REPORT_DIR, 'data', 'report.json');
  const p2 = path.join(REPORT_DIR, 'report.json');

  let failures = [];
  let summary  = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };

  // 1) Coba baca report.json
  const raw = readIfExists(p1) || readIfExists(p2);
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      ({ failures, summary } = collectFailuresFromReport(obj));
    } catch {}
  }

  // 2) Fallback: kalau tidak ketemu failure, scan test-results
  const logSaysFailed = /(\d+)\s+failed/i.test(logBuf) || (summary.failed === 0 && /✘|\bfail(ed)?\b/i.test(logBuf));
  if (failures.length === 0 && logSaysFailed) {
    const scanned = scanFailuresFromTestResults(TEST_RESULTS_DIR);
    if (scanned.length) {
      failures = scanned;
      // estimasi summary dari log
      const m = logBuf.match(/(\d+)\s+failed/i);
      summary.failed = m ? Number(m[1]) : scanned.length;
      const p = logBuf.match(/(\d+)\s+passed/i);
      if (p) summary.passed = Number(p[1]);
      const t = logBuf.match(/(\d+)\s+passed.*\n.*\b(\d+)\s+failed/i);
      summary.total = (p ? Number(p[1]) : 0) + summary.failed;
    }
  }

  // 3) Fallback terakhir: jika masih kosong, coba parse judul dari log (tanpa artifacts)
  if (failures.length === 0 && logSaysFailed) {
    failures = parseFailuresFromLogs(logBuf);
    const m = logBuf.match(/(\d+)\s+failed/i);
    summary.failed = m ? Number(m[1]) : failures.length;
    const p = logBuf.match(/(\d+)\s+passed/i);
    summary.passed = p ? Number(p[1]) : 0;
    summary.total  = summary.passed + summary.failed;
  }

  res.json({ summary, failures });
});


// =====================[ Misc ]============================
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const resolved = resolvePlaywrightBin();
  console.log(`JR SQA Scheduler ready at http://localhost:${PORT}`);
  console.log('Playwright resolver:', resolved ? `${resolved.type} → ${resolved.cmd}` : 'NOT FOUND');
});
