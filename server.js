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
  throughput: { label: 'Throughput', note: '~3 นาที · ไต่อัตรา req/s หาเพดาน' },
  breakpoint: { label: 'Breakpoint', note: 'สูงสุด ~15 นาที · ไต่จนพังแล้วหยุดเอง' },
  soak:     { label: 'Soak', note: 'กำหนดเวลาเอง · หา memory leak' },
  security: { label: 'Security (OWASP)', note: '~30 วินาที · สแกนช่องโหว่' },
  fuzz:     { label: 'API Fuzzing', note: '~15 วินาที · input ผิดรูปแบบ' },
  payload:  { label: 'Payload', note: '~1 นาที · ส่ง body ใหญ่ (1KB→10MB)' },
  defense:  { label: 'Defense', note: '~1 นาที · ยิงหนักเช็กว่าเกราะ (429/503) ทำงาน' },
};

// duration ต้องอยู่ในรูป เช่น 30s, 10m, 1h
const DUR_RE = /^\d+(\.\d+)?(ms|s|m|h)$/;
const f = (key, label, type, dflt, kw = {}) => ({ key, label, type, default: dflt, ...kw });

// พารามิเตอร์ที่ปรับได้ต่อการรัน (key = env var ที่ test อ่าน; default ควรตรงกับ PROFILES)
const TEST_OPTIONS = {
  smoke:      [f('VUS', 'จำนวนผู้ใช้ (VUs)', 'int', 1, { min: 1, max: 200 }), f('DURATION', 'ระยะเวลา', 'dur', '30s', { ph: 'เช่น 30s, 2m' })],
  load:       [f('VUS', 'จำนวนผู้ใช้ (VUs)', 'int', 50, { min: 1, max: 2000 }), f('DURATION', 'ระยะเวลา', 'dur', '5m', { ph: 'เช่น 5m, 30m' })],
  stress:     [f('MAX_VUS', 'VUs สูงสุด', 'int', 300, { min: 1, max: 5000 }), f('RAMP_MIN', 'เวลาไต่ (นาที)', 'int', 10, { min: 1, max: 120 })],
  spike:      [f('BASE_VUS', 'VUs ช่วงปกติ', 'int', 20, { min: 1, max: 2000 }), f('PEAK_VUS', 'VUs ช่วงพีค', 'int', 500, { min: 1, max: 20000 })],
  throughput: [f('START_RATE', 'เริ่มที่ (req/s)', 'int', 50, { min: 1, max: 20000 }), f('STEP_RATE', 'เพิ่มขั้นละ (req/s)', 'int', 50, { min: 1, max: 20000 }), f('STEPS', 'จำนวนขั้น', 'int', 6, { min: 1, max: 50 }), f('STAGE_SEC', 'แต่ละขั้น (วินาที)', 'int', 30, { min: 5, max: 600 })],
  breakpoint: [f('MAX_RATE', 'ไต่ถึง (req/s)', 'int', 2000, { min: 10, max: 100000 }), f('RAMP_MIN', 'เวลาไต่ (นาที)', 'int', 15, { min: 1, max: 120 })],
  soak:       [f('VUS', 'จำนวนผู้ใช้ (VUs)', 'int', 40, { min: 1, max: 2000 }), f('DURATION', 'ระยะเวลา', 'dur', '1h', { ph: 'เช่น 1h, 30m' })],
  security:   [],
  fuzz:       [],
  payload:    [f('MAX_BODY_MB', 'body ใหญ่สุด (MB)', 'int', 10, { min: 1, max: 100 }), f('PER_SIZE', 'ยิงต่อขนาด (ครั้ง)', 'int', 5, { min: 1, max: 100 })],
  defense:    [f('RATE', 'อัตรายิง (req/s)', 'int', 1000, { min: 1, max: 200000 }), f('SECONDS', 'ระยะเวลา (วินาที)', 'int', 60, { min: 5, max: 3600 })],
};

// คัดเฉพาะ option ที่ถูกต้องของชุดนั้น คืน { ENV_KEY: 'value' }
function validateOptions(test, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const fd of TEST_OPTIONS[test] || []) {
    const v = raw[fd.key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    if (fd.type === 'int') {
      const iv = Math.trunc(Number(v));
      if (!Number.isFinite(iv) || iv < (fd.min ?? 1) || iv > (fd.max ?? 1e12)) continue;
      out[fd.key] = String(iv);
    } else if (fd.type === 'dur' && DUR_RE.test(String(v).trim())) {
      out[fd.key] = String(v).trim();
    }
  }
  return out;
}

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
function startRun({ test, baseUrl, authToken, options }) {
  const runId = randomUUID();
  const state = { runId, test, baseUrl, lines: [], done: false, exitCode: null, listeners: [], startedAt: Date.now() };
  runs.set(runId, state);

  const env = { ...process.env, TEST_TYPE: test, BASE_URL: baseUrl };
  if (authToken) env.AUTH_TOKEN = authToken;

  const args = ['run', '-e', `TEST_TYPE=${test}`, '-e', `BASE_URL=${baseUrl}`];
  const shown = [...args]; // สำเนาไว้โชว์ใน log โดยปิดบัง token
  if (authToken) { args.push('-e', `AUTH_TOKEN=${authToken}`); shown.push('-e', 'AUTH_TOKEN=***'); }
  for (const [k, v] of Object.entries(options || {})) { // พารามิเตอร์จากหน้าเว็บ (ตรวจแล้ว)
    env[k] = v; args.push('-e', `${k}=${v}`); shown.push('-e', `${k}=${v}`);
  }
  args.push(path.join('tests', `${test}.js`));
  shown.push(path.join('tests', `${test}.js`));

  push(state, `▶ เริ่ม ${test} → ${baseUrl}`);
  push(state, `  คำสั่ง: k6 ${shown.join(' ')}`);

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
// กันเว็บอื่นสั่งรัน k6 ผ่านเบราว์เซอร์ของผู้ใช้ (CSRF / DNS rebinding)
//   Host ต้องเป็น server นี้, Origin (ถ้ามี) ต้องเป็นหน้าเว็บนี้ — ตรงกับ server.py
// ---------------------------------------------------------------------------
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`,
  ...(PORT === 80 ? ['127.0.0.1', 'localhost'] : [])]);
const hostOk = (h) => ALLOWED_HOSTS.has(String(h || '').trim().toLowerCase());
function originOk(origin) {
  if (!origin) return true; // ไม่มี Origin (เช่น curl) = ผ่าน
  try { const x = new URL(String(origin).trim().toLowerCase()); return x.protocol === 'http:' && ALLOWED_HOSTS.has(x.host); }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (!hostOk(req.headers.host)) return sendJSON(res, 403, { error: `Host ไม่ถูกต้อง — เปิดผ่าน http://${HOST}:${PORT} เท่านั้น` });
  if (req.method === 'POST') {
    if (!originOk(req.headers.origin)) return sendJSON(res, 403, { error: 'ไม่อนุญาตคำขอจากเว็บอื่น' });
    // application/json บังคับให้เบราว์เซอร์ทำ CORS preflight ซึ่ง server ไม่อนุญาต
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') return sendJSON(res, 415, { error: 'ต้องส่งเป็น application/json' });
  }
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = u.pathname;

  // --- static pages ---
  if (p === '/' || p === '/index.html') return sendFile(res, path.join(WEB, 'index.html'), MIME['.html']);
  if (p === '/dashboard' || p === '/dashboard.html') return sendFile(res, path.join(WEB, 'dashboard.html'), MIME['.html']);
  if (p.startsWith('/web/')) {
    const f = path.join(WEB, p.slice(5));
    if (!f.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end(); }
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
    return sendJSON(res, 200, { tests: TESTS, options: TEST_OPTIONS, defaultBaseUrl: cfgDefault });
  }

  // --- API: สั่งรัน ---
  if (p === '/api/run' && req.method === 'POST') {
    const body = await readBody(req);
    const { test, baseUrl, authToken, authorized } = body;
    if (!TESTS[test]) return sendJSON(res, 400, { error: 'ชุดทดสอบไม่ถูกต้อง' });
    if (!validUrl(baseUrl)) return sendJSON(res, 400, { error: 'BASE_URL ต้องเป็น http(s) ที่ถูกต้อง' });
    if (!authorized) return sendJSON(res, 400, { error: 'ต้องยืนยันว่าได้รับอนุญาตให้ทดสอบเป้าหมายนี้ก่อน' });
    const options = validateOptions(test, body.options);
    const runId = startRun({ test, baseUrl, authToken, options });
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
