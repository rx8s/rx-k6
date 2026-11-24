// ============================================================================
// report-core.js — logic อ่าน/สรุปผล k6 ที่ใช้ร่วมกัน (make-report.js + server.js)
//   CommonJS module สำหรับฝั่ง Node เท่านั้น (ไม่ใช่ k6 script)
// ============================================================================
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

const TYPE_LABEL = {
  smoke: 'Smoke (เช็กเบื้องต้น)',
  load: 'Load (โหลดปกติ)',
  stress: 'Stress (หาจุดพัง)',
  spike: 'Spike (traffic พุ่ง)',
  soak: 'Soak (รันยาว)',
  throughput: 'Throughput (เพดาน req/s)',
  breakpoint: 'Breakpoint (จุดพังจริง)',
  security: 'Security (OWASP)',
  fuzz: 'API Fuzzing',
  payload: 'Payload (body ใหญ่)',
  defense: 'Defense (เกราะกันโหลด)',
};

const num = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? Number(v.toFixed(d)) : null);

// อ่านไฟล์ผลล่าสุดของแต่ละ test type
function loadLatestPerType() {
  if (!fs.existsSync(REPORTS_DIR)) return {};
  const files = fs.readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'latest.json' && f !== 'executive-report.json');

  const byType = {};
  for (const f of files) {
    const type = f.split(/-\d{4}-\d{2}-\d{2}/)[0];
    const full = path.join(REPORTS_DIR, f);
    const mtime = fs.statSync(full).mtimeMs;
    if (!byType[type] || mtime > byType[type].mtime) byType[type] = { mtime, file: full, name: f };
  }
  const result = {};
  for (const [type, info] of Object.entries(byType)) {
    try {
      result[type] = { ...info, data: JSON.parse(fs.readFileSync(info.file, 'utf8')) };
    } catch (e) { /* ข้ามไฟล์เสีย */ }
  }
  return result;
}

// ดึง metric สำคัญจาก summary ดิบของ k6
function metrics(data) {
  const m = (data && data.metrics) || {};
  const dur = (m.http_req_duration && m.http_req_duration.values) || {};
  const failed = (m.http_req_failed && m.http_req_failed.values) || {};
  const reqs = (m.http_reqs && m.http_reqs.values) || {};
  const vus = (m.vus_max && m.vus_max.values) || {};
  const checks = (m.checks && m.checks.values) || {};
  const sec = (m.security_findings && m.security_findings.values) || {};
  const biz = (m.business_errors && m.business_errors.values) || {};
  const rl = (m.rate_limited && m.rate_limited.values) || {};
  const oversize = (m.oversize_rejected && m.oversize_rejected.values) || {};

  let thrOk = true, thrTotal = 0;
  for (const met of Object.values(m)) {
    if (met && met.thresholds) {
      for (const t of Object.values(met.thresholds)) {
        thrTotal++;
        if (t && t.ok === false) thrOk = false;
      }
    }
  }

  return {
    totalReqs: reqs.count || 0,
    rps: num(reqs.rate, 2) || 0,
    avg: num(dur.avg, 1), p95: num(dur['p(95)'], 1), p99: num(dur['p(99)'], 1), max: num(dur.max, 1),
    failRate: num((failed.rate || 0) * 100, 2) || 0,
    maxVus: vus.max || vus.value || 0,
    checkRate: num((checks.rate != null ? checks.rate : 1) * 100, 1),
    checkPass: checks.passes || 0, checkFail: checks.fails || 0,
    securityFindings: sec.count || 0,
    bizErrors: biz.count || 0,
    rateLimited: rl.count || 0,
    oversizeRejected: oversize.count || 0,
    thrOk, thrTotal,
  };
}

// ตัดสิน verdict (green/yellow/red) + ข้อความ
function verdict(type, mx) {
  if (type === 'security') {
    if (mx.securityFindings > 0) return ['red', `พบจุดน่าสงสัย ${mx.securityFindings} จุด`];
    return ['green', 'ไม่พบช่องโหว่จาก payload มาตรฐาน'];
  }
  if (type === 'fuzz') {
    if (mx.bizErrors > 0) return ['yellow', `จัดการ input แปลกไม่ดี ${mx.bizErrors} ครั้ง (ตอบ 5xx/ล่ม)`];
    return ['green', 'รับมือ input ผิดรูปแบบได้ดี (ไม่ crash)'];
  }
  if (type === 'throughput') {
    if (mx.bizErrors > 0) return ['red', `มี error จริง ${mx.bizErrors} ครั้งขณะไต่อัตรา — เพดานจริงต่ำกว่า ~${mx.rps} req/s`];
    if (mx.rateLimited > 0) return ['yellow', `แตะ rate limit (429) ${mx.rateLimited} ครั้ง — ระบบจำกัดอัตราที่ ~${mx.rps} req/s`];
    return ['green', `รับได้เฉลี่ย ~${mx.rps} req/s โดยไม่มี error`];
  }
  if (type === 'payload') {
    if (mx.bizErrors > 0) return ['red', `จัดการ body ใหญ่ไม่ดี ${mx.bizErrors} ครั้ง (5xx/timeout/ล่ม)`];
    if (mx.oversizeRejected > 0) return ['green', `ปฏิเสธ body ใหญ่เกินด้วย 413 อย่างถูกต้อง (${mx.oversizeRejected} ครั้ง)`];
    return ['green', 'รับ body ขนาดต่างๆ ได้โดยไม่ล่ม'];
  }
  if (type === 'breakpoint') {
    if (mx.thrOk) return ['green', `รับโหลดได้ตลอดช่วง ไต่ถึง ~${mx.maxVus} VUs โดยไม่พัง — เพิ่ม maxRate เพื่อหาเพดานต่อ`];
    if (mx.bizErrors > 0) return ['red', `พบจุดพังที่ ~${mx.maxVus} VUs — ระบบเริ่มตอบ error จริง ${mx.bizErrors} ครั้ง (p95 ${mx.p95}ms)`];
    return ['yellow', `พบเพดานที่ ~${mx.maxVus} VUs — ชะลอจน p95 ${mx.p95}ms (ยังไม่ crash)`];
  }
  if (type === 'defense') {
    if (mx.bizErrors > 0) return ['red', `เกราะไม่ไหว: ระบบตอบ 5xx/timeout ${mx.bizErrors} ครั้งภายใต้โหลดหนัก`];
    if (mx.rateLimited > 0) return ['green', `เกราะทำงาน: จำกัดอัตราด้วย 429/503 ${mx.rateLimited} ครั้ง ระบบไม่ล่ม`];
    return ['yellow', `ไม่พบการจำกัดอัตราภายใต้โหลด ~${mx.rps} req/s — ระบบรับไว้ทั้งหมด (ตรวจว่ามีเกราะกัน DDoS หรือยัง)`];
  }
  if (mx.failRate >= 5) return ['red', `error rate สูง ${mx.failRate}%`];
  if (!mx.thrOk || mx.failRate >= 1) return ['yellow', `ใกล้เกิน SLA (error ${mx.failRate}%, p95 ${mx.p95}ms)`];
  return ['green', `ผ่าน SLA (error ${mx.failRate}%, p95 ${mx.p95}ms)`];
}

// รวมทุก type เป็นโครงสร้างเดียว (ใช้ได้ทั้ง API และ render HTML)
function aggregate() {
  const all = loadLatestPerType();
  let baseUrl = '—';
  const latest = path.join(REPORTS_DIR, 'latest.json');
  if (fs.existsSync(latest)) {
    try { baseUrl = JSON.parse(fs.readFileSync(latest, 'utf8')).baseUrl || '—'; } catch (e) {}
  }

  const rank = { green: 0, yellow: 1, red: 2 };
  let worst = 'green';
  const tests = [];

  for (const [type, info] of Object.entries(all)) {
    const mx = metrics(info.data);
    const [color, msg] = verdict(type, mx);
    if (rank[color] > rank[worst]) worst = color;
    tests.push({
      type,
      label: TYPE_LABEL[type] || type,
      color, verdict: msg,
      metrics: mx,
      ranAt: new Date(info.mtime).toISOString(),
    });
  }

  // เรียงตามลำดับที่อ่านง่าย
  const order = ['smoke', 'load', 'stress', 'spike', 'throughput', 'breakpoint', 'soak', 'security', 'fuzz', 'payload', 'defense'];
  tests.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  const overall = { green: 'ระบบอยู่ในเกณฑ์ดี', yellow: 'มีจุดควรเฝ้าระวัง', red: 'มีประเด็นที่ต้องแก้ไข' }[worst];
  return { baseUrl, worst, overall, tests, generatedAt: new Date().toISOString() };
}

module.exports = { REPORTS_DIR, TYPE_LABEL, loadLatestPerType, metrics, verdict, aggregate, num };
