#!/usr/bin/env node
// ============================================================================
// make-report.js — รวมผล k6 ทุกชุดใน reports/*.json เป็นรายงาน HTML สำหรับผู้บริหาร
//   ใช้งาน:  node scripts/make-report.js
//   ผลลัพธ์: reports/executive-report.html
// ============================================================================
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const OUT = path.join(REPORTS_DIR, 'executive-report.html');

function loadLatestPerType() {
  if (!fs.existsSync(REPORTS_DIR)) return {};
  const files = fs.readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'latest.json' && f !== 'executive-report.json');

  const byType = {};
  for (const f of files) {
    const type = f.split(/-\d{4}-\d{2}-\d{2}/)[0]; // ตัดชื่อก่อนวันที่
    const full = path.join(REPORTS_DIR, f);
    const mtime = fs.statSync(full).mtimeMs;
    if (!byType[type] || mtime > byType[type].mtime) {
      byType[type] = { mtime, file: full, name: f };
    }
  }
  const result = {};
  for (const [type, info] of Object.entries(byType)) {
    try {
      result[type] = { ...info, data: JSON.parse(fs.readFileSync(info.file, 'utf8')) };
    } catch (e) {
      console.warn(`อ่านไฟล์ไม่ได้: ${info.name} — ${e.message}`);
    }
  }
  return result;
}

const num = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');

function metrics(data) {
  const m = (data && data.metrics) || {};
  const dur = (m.http_req_duration && m.http_req_duration.values) || {};
  const failed = (m.http_req_failed && m.http_req_failed.values) || {};
  const reqs = (m.http_reqs && m.http_reqs.values) || {};
  const vus = (m.vus_max && m.vus_max.values) || {};
  const checks = (m.checks && m.checks.values) || {};
  const sec = (m.security_findings && m.security_findings.values) || {};
  const biz = (m.business_errors && m.business_errors.values) || {};

  // threshold ผ่านหมดไหม
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
    rps: reqs.rate || 0,
    avg: dur.avg, p95: dur['p(95)'], p99: dur['p(99)'], max: dur.max,
    failRate: (failed.rate || 0) * 100,
    maxVus: vus.max || vus.value || 0,
    checkRate: (checks.rate != null ? checks.rate : 1) * 100,
    checkPass: checks.passes || 0, checkFail: checks.fails || 0,
    securityFindings: sec.count || 0,
    bizErrors: biz.count || 0,
    thrOk, thrTotal,
  };
}

// ตัดสิน verdict ต่อชุดทดสอบ (เขียว/เหลือง/แดง)
function verdict(type, mx) {
  if (type === 'security') {
    if (mx.securityFindings > 0) return ['red', `พบจุดน่าสงสัย ${mx.securityFindings} จุด`];
    return ['green', 'ไม่พบช่องโหว่จาก payload มาตรฐาน'];
  }
  if (type === 'fuzz') {
    if (mx.bizErrors > 0) return ['yellow', `จัดการ input แปลกไม่ดี ${mx.bizErrors} ครั้ง (ตอบ 5xx/ล่ม)`];
    return ['green', 'รับมือ input ผิดรูปแบบได้ดี (ไม่ crash)'];
  }
  // ชุดโหลด
  if (mx.failRate >= 5) return ['red', `error rate สูง ${num(mx.failRate)}%`];
  if (!mx.thrOk || mx.failRate >= 1) return ['yellow', `ใกล้เกิน SLA (error ${num(mx.failRate)}%, p95 ${num(mx.p95,0)}ms)`];
  return ['green', `ผ่าน SLA (error ${num(mx.failRate)}%, p95 ${num(mx.p95,0)}ms)`];
}

const TYPE_LABEL = {
  smoke: 'Smoke (เช็กเบื้องต้น)',
  load: 'Load (โหลดปกติ)',
  stress: 'Stress (หาจุดพัง)',
  spike: 'Spike (traffic พุ่ง)',
  soak: 'Soak (รันยาว)',
  security: 'Security (OWASP)',
  fuzz: 'API Fuzzing',
};

function render(all) {
  const types = Object.keys(all);
  const rows = [];
  const cards = [];
  let worst = 'green';
  const rank = { green: 0, yellow: 1, red: 2 };

  // ดึง target จาก latest.json ถ้ามี
  let baseUrl = '—';
  const latest = path.join(REPORTS_DIR, 'latest.json');
  if (fs.existsSync(latest)) {
    try { baseUrl = JSON.parse(fs.readFileSync(latest, 'utf8')).baseUrl || '—'; } catch (e) {}
  }

  for (const type of types) {
    const mx = metrics(all[type].data);
    const [color, msg] = verdict(type, mx);
    if (rank[color] > rank[worst]) worst = color;
    const label = TYPE_LABEL[type] || type;

    cards.push(`
      <div class="card ${color}">
        <div class="card-h">${label}</div>
        <div class="badge ${color}">${{green:'ผ่าน',yellow:'เฝ้าระวัง',red:'ต้องแก้'}[color]}</div>
        <div class="card-msg">${msg}</div>
      </div>`);

    rows.push(`
      <tr>
        <td><b>${label}</b></td>
        <td class="dot ${color}"></td>
        <td>${mx.totalReqs.toLocaleString()}</td>
        <td>${num(mx.rps,1)}</td>
        <td>${num(mx.p95,0)}</td>
        <td>${num(mx.p99,0)}</td>
        <td>${num(mx.failRate)}%</td>
        <td>${mx.maxVus}</td>
        <td>${type==='security'?mx.securityFindings:(type==='fuzz'?mx.bizErrors:num(mx.checkRate,1)+'%')}</td>
      </tr>`);
  }

  const overall = { green: 'ระบบอยู่ในเกณฑ์ดี', yellow: 'มีจุดควรเฝ้าระวัง', red: 'มีประเด็นที่ต้องแก้ไข' }[worst];

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>รายงานผลทดสอบระบบ (ผู้บริหาร)</title>
<style>
  :root{--green:#16a34a;--yellow:#d97706;--red:#dc2626;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc}
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI","Noto Sans Thai",sans-serif;margin:0;background:var(--bg);color:var(--ink);line-height:1.6}
  .wrap{max-width:1000px;margin:0 auto;padding:40px 24px}
  header{border-bottom:3px solid var(--ink);padding-bottom:16px;margin-bottom:28px}
  h1{margin:0 0 6px;font-size:26px}
  .meta{color:var(--muted);font-size:14px}
  .verdict{display:flex;align-items:center;gap:14px;padding:18px 22px;border-radius:12px;margin:24px 0;font-size:18px;font-weight:600;background:#fff;border:1px solid var(--line)}
  .verdict .light{width:18px;height:18px;border-radius:50%}
  .green{color:var(--green)} .yellow{color:var(--yellow)} .red{color:var(--red)}
  .light.green{background:var(--green)}.light.yellow{background:var(--yellow)}.light.red{background:var(--red)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:20px 0}
  .card{background:#fff;border:1px solid var(--line);border-left:5px solid var(--muted);border-radius:10px;padding:16px}
  .card.green{border-left-color:var(--green)}.card.yellow{border-left-color:var(--yellow)}.card.red{border-left-color:var(--red)}
  .card-h{font-weight:700;font-size:15px;margin-bottom:8px}
  .card-msg{font-size:13px;color:var(--muted);margin-top:8px}
  .badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;color:#fff}
  .badge.green{background:var(--green)}.badge.yellow{background:var(--yellow)}.badge.red{background:var(--red)}
  h2{font-size:18px;margin:34px 0 12px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13px}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
  th{background:var(--ink);color:#fff;font-weight:600;font-size:12px}
  td.dot{text-align:center}
  .dot::before{content:"";display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--muted)}
  .dot.green::before{background:var(--green)}.dot.yellow::before{background:var(--yellow)}.dot.red::before{background:var(--red)}
  .note{font-size:12px;color:var(--muted);margin-top:28px;padding-top:16px;border-top:1px solid var(--line)}
  .gloss{font-size:13px;color:var(--muted)} .gloss b{color:var(--ink)}
</style></head>
<body><div class="wrap">
  <header>
    <h1>รายงานผลทดสอบความทนทานและความปลอดภัยของระบบ</h1>
    <div class="meta">เป้าหมาย: <b>${baseUrl}</b> &nbsp;·&nbsp; วันที่: ${new Date().toLocaleString('th-TH')} &nbsp;·&nbsp; เครื่องมือ: k6</div>
  </header>

  <div class="verdict ${worst}"><span class="light ${worst}"></span><span>ผลโดยรวม: ${overall}</span></div>

  <h2>สรุปรายด้าน</h2>
  <div class="cards">${cards.join('')}</div>

  <h2>ตารางตัวชี้วัด</h2>
  <table>
    <thead><tr>
      <th>ชุดทดสอบ</th><th>สถานะ</th><th>Requests</th><th>req/s</th>
      <th>p95 (ms)</th><th>p99 (ms)</th><th>Error</th><th>Peak VUs</th><th>Checks/พบ</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>

  <h2>อ่านค่าอย่างไร</h2>
  <p class="gloss">
    <b>p95/p99</b> = เวลาตอบสนองที่ 95% / 99% ของ request เร็วกว่าค่านี้ (ยิ่งต่ำยิ่งดี) ·
    <b>Error</b> = สัดส่วน request ที่ล้มเหลว (เป้าหมาย &lt; 1%) ·
    <b>Peak VUs</b> = จำนวนผู้ใช้จำลองสูงสุดพร้อมกัน ·
    <b>Checks</b> = สัดส่วนการตรวจที่ผ่าน; ด้าน Security/Fuzz แสดง "จำนวนจุดที่พบ"
  </p>

  <div class="note">
    รายงานนี้สร้างอัตโนมัติจากผลการทดสอบด้วย k6 บนระบบที่ได้รับอนุญาต
    เพื่อประเมินสมรรถนะและความทนทานเท่านั้น · ผล Security เป็นการตรวจเบื้องต้นด้วย payload มาตรฐาน
    ไม่ทดแทนการตรวจประเมินความปลอดภัยเชิงลึกโดยผู้เชี่ยวชาญ
  </div>
</div></body></html>`;
}

function main() {
  const all = loadLatestPerType();
  if (Object.keys(all).length === 0) {
    console.error('ยังไม่มีผลใน reports/ — รันชุดทดสอบก่อน เช่น: npm run smoke');
    process.exit(1);
  }
  fs.writeFileSync(OUT, render(all), 'utf8');
  console.log(`✅ สร้างรายงานผู้บริหารแล้ว: ${OUT}`);
  console.log(`   ชุดทดสอบที่รวม: ${Object.keys(all).join(', ')}`);
}

main();
