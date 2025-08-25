/**
 * JR SQA Scheduler Server (fresh build)
 * -------------------------------------
 * Fitur:
 * - Start/stop auto-run Playwright tests dengan interval menit/jam
 * - Jalankan sekali manual (/run)
 * - Status & ringkasan hasil run terakhir (/status)
 * - Live logs tail sederhana (/logs)
 * - Sajikan report Playwright (HTML/JSON) lewat /playwright-report
 *
 * Cara pakai:
 *   npm i express
 *   node server.js
 *   Buka http://localhost:3000
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());

// ==== Konfigurasi dasar (bisa disesuaikan) ====
const REPORT_DIR = path.join(__dirname, 'playwright-report');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_CMD = ['playwright', 'test', '--project=jr']; // npx playwright test --project=jr
const NX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Sajikan file statis (UI)
app.use(express.static(PUBLIC_DIR));
// Sajikan report Playwright jika sudah ada
app.use('/playwright-report', express.static(REPORT_DIR));

// ==== State scheduler ====
let timer = null;
let schedule = { mode: null, value: null, ms: null };
let lastRun = { startedAt: null, endedAt: null, exitCode: null, durationMs: null };
let running = false;
let wantAnotherRun = false;

// Ringkas logs terakhir (max ~5000 chars)
let logBuf = '';
const appendLog = (chunk) => {
  const s = String(chunk || '');
  logBuf += s;
  if (logBuf.length > 5000) {
    logBuf = logBuf.slice(-5000);
  }
};

async function runPlaywrightOnce() {
  if (running) {
    // Jika sedang running dan ada trigger baru, tandai supaya jalan lagi setelah selesai
    wantAnotherRun = true;
    return;
  }
  running = true;
  wantAnotherRun = false;
  lastRun.startedAt = new Date().toISOString();
  lastRun.endedAt = null;
  lastRun.exitCode = null;
  lastRun.durationMs = null;

  appendLog(`\n==== Run started at ${lastRun.startedAt} ====\n`);

  const cmd = NX;
  const args = DEFAULT_CMD.slice();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const startTs = Date.now();

  child.stdout.on('data', (d) => appendLog(d));
  child.stderr.on('data', (d) => appendLog(d));

  await new Promise((resolve) => {
    child.on('close', (code) => {
      lastRun.endedAt = new Date().toISOString();
      lastRun.exitCode = code;
      lastRun.durationMs = Date.now() - startTs;
      appendLog(`\n==== Run ended at ${lastRun.endedAt} with code ${code} (duration ${lastRun.durationMs} ms) ====\n`);
      resolve();
    });
  });

  running = false;

  // Jika ada permintaan run lagi selama proses, jalankan sekali lagi
  if (wantAnotherRun) {
    wantAnotherRun = false;
    setTimeout(runPlaywrightOnce, 250); // kecilkan jeda agar tidak tabrakan
  }
}

function scheduleRunner() {
  if (!schedule.mode || !schedule.value) return;
  const valueNum = Number(schedule.value);
  if (!valueNum || valueNum <= 0) return;

  const ms = schedule.mode === 'minutes' ? valueNum * 60 * 1000 : valueNum * 60 * 60 * 1000;
  schedule.ms = ms;

  if (timer) clearInterval(timer);

  // Jalankan langsung satu kali saat set
  runPlaywrightOnce();
  // Lanjut interval
  timer = setInterval(() => {
    runPlaywrightOnce();
  }, ms);
}

// ==== API ====

// Jalankan sekali manual
app.post('/run', async (_req, res) => {
  runPlaywrightOnce();
  res.json({ ok: true, msg: running ? 'Run started' : 'Queued to run' });
});

// Mulai auto-run
app.post('/start', (req, res) => {
  const { mode, value } = req.query; // gunakan querystring agar mudah dipanggil dari UI
  if (!mode || !value || !['minutes', 'hours'].includes(mode)) {
    return res.status(400).json({ ok: false, msg: 'Gunakan ?mode=minutes|hours&value=angka' });
  }
  schedule = { mode, value: Number(value), ms: null };
  scheduleRunner();
  res.json({ ok: true, schedule });
});

// Stop auto-run
app.post('/stop', (_req, res) => {
  if (timer) clearInterval(timer);
  timer = null;
  schedule = { mode: null, value: null, ms: null };
  res.json({ ok: true, msg: 'Auto-run dihentikan' });
});

// Status ringkas
app.get('/status', (_req, res) => {
  res.json({
    running,
    schedule,
    lastRun,
    reportHtml: '/playwright-report/index.html',
    reportJson: '/playwright-report/report.json'
  });
});

// Ambil tail logs
app.get('/logs', (_req, res) => {
  res.type('text/plain').send(logBuf || 'No logs yet.');
});

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JR SQA Scheduler ready at http://localhost:${PORT}`);
  console.log(`UI: http://localhost:${PORT}/  |  Status: /status  |  Logs: /logs`);
});
