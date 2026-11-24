#!/usr/bin/env node
// ============================================================================
// make-report.js — สร้างรายงาน HTML ผู้บริหาร (static) จากผลล่าสุดใน reports/
//   ใช้งาน:  node scripts/make-report.js   →   reports/executive-report.html
//   หมายเหตุ: ต้องการ dashboard แบบ interactive ให้ใช้ `npm run web` แทน
// ============================================================================
const fs = require('fs');
const path = require('path');
const { aggregate } = require('./report-core.js');

const OUT = path.join(__dirname, '..', 'reports', 'executive-report.html');
const n = (v) => (v == null ? '—' : v);

function render(agg) {
  const badge = { green: 'ผ่าน', yellow: 'เฝ้าระวัง', red: 'ต้องแก้' };
  const cards = agg.tests.map((t) => `
      <div class="card ${t.color}">
        <div class="card-h">${t.label}</div>
        <div class="badge ${t.color}">${badge[t.color]}</div>
        <div class="card-msg">${t.verdict}</div>
      </div>`).join('');

  const rows = agg.tests.map((t) => {
    const m = t.metrics;
    const last = t.type === 'security' ? m.securityFindings
      : t.type === 'fuzz' ? m.bizErrors
      : (m.checkRate != null ? m.checkRate + '%' : '—');
    return `
      <tr>
        <td><b>${t.label}</b></td>
        <td class="dot ${t.color}"></td>
        <td>${m.totalReqs.toLocaleString()}</td>
        <td>${n(m.rps)}</td>
        <td>${n(m.p95)}</td>
        <td>${n(m.p99)}</td>
        <td>${n(m.failRate)}%</td>
        <td>${m.maxVus}</td>
        <td>${last}</td>
      </tr>`;
  }).join('');

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
    <div class="meta">เป้าหมาย: <b>${agg.baseUrl}</b> &nbsp;·&nbsp; วันที่: ${new Date().toLocaleString('th-TH')} &nbsp;·&nbsp; เครื่องมือ: k6</div>
  </header>
  <div class="verdict ${agg.worst}"><span class="light ${agg.worst}"></span><span>ผลโดยรวม: ${agg.overall}</span></div>
  <h2>สรุปรายด้าน</h2>
  <div class="cards">${cards}</div>
  <h2>ตารางตัวชี้วัด</h2>
  <table>
    <thead><tr>
      <th>ชุดทดสอบ</th><th>สถานะ</th><th>Requests</th><th>req/s</th>
      <th>p95 (ms)</th><th>p99 (ms)</th><th>Error</th><th>Peak VUs</th><th>Checks/พบ</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>อ่านค่าอย่างไร</h2>
  <p class="gloss">
    <b>p95/p99</b> = เวลาตอบสนองที่ 95% / 99% ของ request เร็วกว่าค่านี้ (ยิ่งต่ำยิ่งดี) ·
    <b>Error</b> = สัดส่วน request ที่ล้มเหลว (เป้าหมาย &lt; 1%) ·
    <b>Peak VUs</b> = จำนวนผู้ใช้จำลองสูงสุดพร้อมกัน ·
    <b>Checks</b> = สัดส่วนการตรวจที่ผ่าน; ด้าน Security/Fuzz แสดง "จำนวนจุดที่พบ"
  </p>
  <div class="note">
    รายงานนี้สร้างอัตโนมัติจากผลการทดสอบด้วย k6 บนระบบที่ได้รับอนุญาต เพื่อประเมินสมรรถนะและความทนทานเท่านั้น ·
    ผล Security เป็นการตรวจเบื้องต้นด้วย payload มาตรฐาน ไม่ทดแทนการตรวจประเมินความปลอดภัยเชิงลึกโดยผู้เชี่ยวชาญ
  </div>
</div></body></html>`;
}

function main() {
  const agg = aggregate();
  if (agg.tests.length === 0) {
    console.error('ยังไม่มีผลใน reports/ — รันชุดทดสอบก่อน เช่น: npm run smoke');
    process.exit(1);
  }
  fs.writeFileSync(OUT, render(agg), 'utf8');
  console.log(`✅ สร้างรายงานผู้บริหารแล้ว: ${OUT}`);
  console.log(`   ชุดทดสอบที่รวม: ${agg.tests.map((t) => t.type).join(', ')}`);
}

main();
