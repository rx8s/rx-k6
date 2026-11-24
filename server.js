#!/usr/bin/env node
// ============================================================================
// server.js — web app ควบคุมการทดสอบ + dashboard (Node built-in ล้วน ไม่มี dep)
//   รัน:  npm run web   (หรือ  node server.js)
//   เปิด: http://127.0.0.1:4000
//
//   ⚠️ ผูกกับ 127.0.0.1 เท่านั้น (เครื่องตัวเอง) และยิงทดสอบได้เฉพาะ
//      เป้าหมายที่คุณได้รับอนุญาต — UI บังคับติ๊กยืนยันสิทธิ์ก่อนรัน
// ============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { aggregate, loadLatestPerType, metrics } = require('./scripts/report-core.js');

const ROOT = __dirname;
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 4000);
const HOST = '127.0.0.1'; // local-only เพื่อความปลอดภัย

// ชุดทดสอบที่อนุญาตให้สั่งผ่าน UI (allowlist กัน command injection)
const TESTS = {
  // note = เวลาโดยประมาณตาม PROFILES ใน config/config.js (แก้คู่กันถ้าปรับ profile)
  smoke:    { label: 'Smoke', note: '~30 วินาที · เช็กว่าระบบตอบได้' },
  load:     { label: 'Load', note: '~5 นาที · ผู้ใช้คงที่' },
  stress:   { label: 'Stress', note: '~12 นาที · ไต่โหลดหาจุดพัง' },
  spike:    { label: 'Spike', note: '~6 นาที · traffic พุ่งแล้วลด' },
  soak:     { label: 'Soak', note: 'กำหนดเวลาเอง · หา memory leak' },
  security: { label: 'Security (OWASP)', note: '~30 วินาที · สแกนช่องโหว่' },
  fuzz:     { label: 'API Fuzzing', note: '~15 วินาที · input ผิดรูปแบบ' },
};

// เก็บสถานะ run ในหน่วยความจำ: runId -> { test, lines[], done, exitCode, listeners[] }
const runs = new Map();

// ---------------------------------------------------------------------------
// helper ส่ง response
// ---------------------------------------------------------------------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// ตรวจ BASE_URL แบบเบื้องต้น (ต้องเป็น http/https)
function validUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// เริ่มรันชุดทดสอบด้วย k6
// ---------------------------------------------------------------------------
function startRun({ test, baseUrl, authToken, soakDuration }) {
  const runId = randomUUID();
  const state = { runId, test, baseUrl, lines: [], done: false, exitCode: null, listeners: [], startedAt: Date.now() };
  runs.set(runId, state);

  const env = { ...process.env, TEST_TYPE: test, BASE_URL: baseUrl };
  if (authToken) env.AUTH_TOKEN = authToken;
  if (test === 'soak' && soakDuration) env.SOAK_DURATION = soakDuration;

  const args = ['run', '-e', `TEST_TYPE=${test}`, '-e', `BASE_URL=${baseUrl}`];
  if (authToken) args.push('-e', `AUTH_TOKEN=${authToken}`);
  if (test === 'soak' && soakDuration) args.push('-e', `SOAK_DURATION=${soakDuration}`);
  args.push(path.join('tests', `${test}.js`));

  push(state, `▶ เริ่ม ${test} → ${baseUrl}`);
  push(state, `  คำสั่ง: k6 ${args.join(' ')}`);

  let child;
  try {
    child = spawn('k6', args, { cwd: ROOT, env });
  } catch (e) {
    push(state, `❌ เรียก k6 ไม่ได้: ${e.message}`);
    finish(state, -1);
    return runId;
  }
  state.pid = child.pid;

  child.stdout.on('data', (d) => d.toString().split(/\r?\n/).forEach((l) => l && push(state, l)));
  child.stderr.on('data', (d) => d.toString().split(/\r?\n/).forEach((l) => l && push(state, l)));
  child.on('error', (e) => { push(state, `❌ ${e.message}`); finish(state, -1); });
  child.on('close', (code) => {
    push(state, '');
    push(state, code === 0 ? '✅ เสร็จสมบูรณ์' : `⚠️ จบด้วย exit code ${code} (ดูผลที่บันทึกไว้ได้ในแดชบอร์ด)`);
    finish(state, code);
  });

  return runId;
}

function push(state, line) {
  state.lines.push(line);
  state.listeners.forEach((fn) => fn({ type: 'line', line }));
}
function finish(state, code) {
  state.done = true;
  state.exitCode = code;
  state.listeners.forEach((fn) => fn({ type: 'done', exitCode: code }));
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = u.pathname;

  // --- static pages ---
  if (p === '/' || p === '/index.html') return sendFile(res, path.join(WEB, 'index.html'), MIME['.html']);
  if (p === '/dashboard' || p === '/dashboard.html') return sendFile(res, path.join(WEB, 'dashboard.html'), MIME['.html']);
  if (p.startsWith('/web/')) {
    const f = path.join(WEB, p.slice(5));
    if (!f.startsWith(WEB)) { res.writeHead(403); return res.end(); }
    return sendFile(res, f, MIME[path.extname(f)] || 'application/octet-stream');
  }

  // --- API: ค่าเริ่มต้น + รายการทดสอบ ---
  if (p === '/api/config') {
    let cfgDefault = 'http://localhost:8080';
    try {
      const txt = fs.readFileSync(path.join(ROOT, 'config', 'config.js'), 'utf8');
      const m = txt.match(/BASE_URL\s*=\s*__ENV\.BASE_URL\s*\|\|\s*'([^']+)'/);
      if (m) cfgDefault = m[1];
    } catch {}
    return sendJSON(res, 200, { tests: TESTS, defaultBaseUrl: cfgDefault });
  }

  // --- API: สั่งรัน ---
  if (p === '/api/run' && req.method === 'POST') {
    const body = await readBody(req);
    const { test, baseUrl, authToken, soakDuration, authorized } = body;
    if (!TESTS[test]) return sendJSON(res, 400, { error: 'ชุดทดสอบไม่ถูกต้อง' });
    if (!validUrl(baseUrl)) return sendJSON(res, 400, { error: 'BASE_URL ต้องเป็น http(s) ที่ถูกต้อง' });
    if (!authorized) return sendJSON(res, 400, { error: 'ต้องยืนยันว่าได้รับอนุญาตให้ทดสอบเป้าหมายนี้ก่อน' });
    const runId = startRun({ test, baseUrl, authToken, soakDuration });
    return sendJSON(res, 200, { runId });
  }

  // --- API: สตรีมผลสด (SSE) ---
  if (p.startsWith('/api/stream/')) {
    const runId = p.split('/').pop();
    const state = runs.get(runId);
    if (!state) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    });
    // ส่ง backlog ที่มีอยู่ก่อน
    state.lines.forEach((line) => res.write(`data: ${JSON.stringify({ type: 'line', line })}\n\n`));
    if (state.done) { res.write(`data: ${JSON.stringify({ type: 'done', exitCode: state.exitCode })}\n\n`); return res.end(); }
    const listener = (ev) => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (ev.type === 'done') res.end();
    };
    state.listeners.push(listener);
    req.on('close', () => { state.listeners = state.listeners.filter((l) => l !== listener); });
    return;
  }

  // --- API: ข้อมูล dashboard (รวมล่าสุดต่อ type) ---
  if (p === '/api/dashboard') {
    return sendJSON(res, 200, aggregate());
  }

  // --- API: ประวัติการรันทั้งหมด (ทุกไฟล์ใน reports) ---
  if (p === '/api/history') {
    const REPORTS = path.join(ROOT, 'reports');
    let items = [];
    try {
      items = fs.readdirSync(REPORTS)
        .filter((f) => f.endsWith('.json') && f !== 'latest.json')
        .map((f) => {
          const full = path.join(REPORTS, f);
          const type = f.split(/-\d{4}-\d{2}-\d{2}/)[0];
          let mx = null;
          try { mx = metrics(JSON.parse(fs.readFileSync(full, 'utf8'))); } catch {}
          return { file: f, type, ranAt: fs.statSync(full).mtimeMs, metrics: mx };
        })
        .sort((a, b) => b.ranAt - a.ranAt);
    } catch {}
    return sendJSON(res, 200, { items });
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log('==================================================');
  console.log('  rx_k6 web app พร้อมใช้งาน');
  console.log(`  เปิด:       http://${HOST}:${PORT}`);
  console.log(`  dashboard:  http://${HOST}:${PORT}/dashboard`);
  console.log('  ⚠️ ทดสอบเฉพาะระบบที่คุณได้รับอนุญาตเท่านั้น');
  console.log('  หยุด: Ctrl+C');
  console.log('==================================================');
});
