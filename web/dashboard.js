// dashboard.js — แสดงผลรวมล่าสุดต่อชุดทดสอบ + กราฟ
const badgeText = { green: 'ผ่าน', yellow: 'เฝ้าระวัง', red: 'ต้องแก้' };
let charts = [];

const n = (v) => (v == null ? '—' : v);

async function load() {
  const agg = await fetch('/api/dashboard').then((r) => r.json());
  const meta = document.getElementById('meta');
  const content = document.getElementById('content');
  charts.forEach((c) => c.destroy());
  charts = [];

  if (!agg.tests || agg.tests.length === 0) {
    meta.textContent = '';
    content.innerHTML = `<div class="empty">
      ยังไม่มีผลการทดสอบ<br><br>
      ไปที่หน้า <a href="/">ควบคุม</a> เพื่อสั่งรันชุดทดสอบก่อน แล้วกลับมาดูที่นี่
    </div>`;
    return;
  }

  meta.innerHTML = `เป้าหมาย: <b>${agg.baseUrl}</b> · อัปเดต: ${new Date(agg.generatedAt).toLocaleString('th-TH')} · รวม ${agg.tests.length} ชุด`;

  // KPI รวม
  const loadTests = agg.tests.filter((t) => !['security', 'fuzz'].includes(t.type));
  const worstP95 = Math.max(0, ...loadTests.map((t) => t.metrics.p95 || 0));
  const worstErr = Math.max(0, ...loadTests.map((t) => t.metrics.failRate || 0));
  const peakVus = Math.max(0, ...agg.tests.map((t) => t.metrics.maxVus || 0));
  const totalReq = agg.tests.reduce((s, t) => s + (t.metrics.totalReqs || 0), 0);
  const secFindings = (agg.tests.find((t) => t.type === 'security') || { metrics: {} }).metrics.securityFindings ?? '—';
  const fuzzErr = (agg.tests.find((t) => t.type === 'fuzz') || { metrics: {} }).metrics.bizErrors ?? '—';

  const errCls = worstErr >= 5 ? 'red' : worstErr >= 1 ? 'yellow' : 'green';
  const secCls = secFindings > 0 ? 'red' : 'green';

  content.innerHTML = `
    <div class="verdict ${agg.worst}">
      <span class="light ${agg.worst}"></span>
      <span class="v${agg.worst}">ผลโดยรวม: ${agg.overall}</span>
    </div>

    <div class="kpi-row">
      <div class="kpi"><div class="k">p95 สูงสุด (โหลด)</div><div class="v">${worstP95 || '—'} <small style="font-size:14px">ms</small></div></div>
      <div class="kpi"><div class="k">Error สูงสุด (โหลด)</div><div class="v ${errCls}">${n(worstErr)}%</div></div>
      <div class="kpi"><div class="k">Peak VUs</div><div class="v">${peakVus}</div></div>
      <div class="kpi"><div class="k">Requests รวม</div><div class="v">${totalReq.toLocaleString()}</div></div>
      <div class="kpi"><div class="k">ช่องโหว่ที่พบ</div><div class="v ${secCls}">${secFindings}</div></div>
      <div class="kpi"><div class="k">Fuzz crash</div><div class="v ${fuzzErr > 0 ? 'yellow' : 'green'}">${fuzzErr}</div></div>
    </div>

    <div class="cards" id="cards"></div>

    <div class="chart-box"><h3>เวลาตอบสนอง p95 vs p99 (ms) รายชุด</h3><canvas id="latChart" height="110"></canvas></div>
    <div class="chart-box"><h3>Error rate รายชุด (%)</h3><canvas id="errChart" height="90"></canvas></div>

    <h3 style="font-size:15px;margin:26px 0 12px">ตารางตัวชี้วัดละเอียด</h3>
    <table id="tbl">
      <thead><tr>
        <th>ชุดทดสอบ</th><th>สถานะ</th><th>Requests</th><th>req/s</th>
        <th>avg</th><th>p95</th><th>p99</th><th>max</th><th>Error</th><th>Peak VUs</th><th>Checks/พบ</th><th>รันเมื่อ</th>
      </tr></thead>
      <tbody></tbody>
    </table>`;

  // การ์ดรายชุด
  const cards = document.getElementById('cards');
  for (const t of agg.tests) {
    const m = t.metrics;
    const special = t.type === 'security' ? `<div class="mini"><span><b>${m.securityFindings}</b>ช่องโหว่</span><span><b>${m.checkPass}</b>ตรวจผ่าน</span></div>`
      : t.type === 'fuzz' ? `<div class="mini"><span><b>${m.bizErrors}</b>crash/5xx</span></div>`
      : `<div class="mini"><span><b>${n(m.p95)}</b>p95 ms</span><span><b>${n(m.failRate)}%</b>error</span><span><b>${m.maxVus}</b>VUs</span></div>`;
    const d = document.createElement('div');
    d.className = 'card ' + t.color;
    d.innerHTML = `<div class="h">${t.label}</div>
      <div class="badge ${t.color}">${badgeText[t.color]}</div>
      <div class="msg">${t.verdict}</div>${special}`;
    cards.appendChild(d);
  }

  // ตาราง
  const tb = document.querySelector('#tbl tbody');
  for (const t of agg.tests) {
    const m = t.metrics;
    const last = t.type === 'security' ? m.securityFindings : t.type === 'fuzz' ? m.bizErrors : (m.checkRate != null ? m.checkRate + '%' : '—');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${t.label}</b></td><td class="dot ${t.color}"></td>
      <td>${m.totalReqs.toLocaleString()}</td><td>${n(m.rps)}</td>
      <td>${n(m.avg)}</td><td>${n(m.p95)}</td><td>${n(m.p99)}</td><td>${n(m.max)}</td>
      <td>${n(m.failRate)}%</td><td>${m.maxVus}</td><td>${last}</td>
      <td>${new Date(t.ranAt).toLocaleString('th-TH')}</td>`;
    tb.appendChild(tr);
  }

  // กราฟ (เฉพาะชุดโหลดที่มี latency)
  if (window.Chart && loadTests.length) {
    const labels = loadTests.map((t) => t.label);
    // ธีม dark ให้กราฟ: ตัวอักษร/เส้น grid อ่านออกบนพื้นเข้ม
    Chart.defaults.color = '#94A3B8';
    Chart.defaults.borderColor = '#2B3750';
    Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
    charts.push(new Chart(document.getElementById('latChart'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'p95', data: loadTests.map((t) => t.metrics.p95 || 0), backgroundColor: '#38bdf8' },
        { label: 'p99', data: loadTests.map((t) => t.metrics.p99 || 0), backgroundColor: '#0ea5e9' },
      ]},
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'ms' } } } },
    }));
    charts.push(new Chart(document.getElementById('errChart'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'error %', data: loadTests.map((t) => t.metrics.failRate || 0),
        backgroundColor: loadTests.map((t) => (t.metrics.failRate >= 5 ? '#EF4444' : t.metrics.failRate >= 1 ? '#F59E0B' : '#22C55E')) }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: 5 } } },
    }));
  }
}

document.getElementById('refreshBtn').addEventListener('click', load);
// รอ Chart.js (defer) โหลดเสร็จก่อนค่อยวาด
window.addEventListener('DOMContentLoaded', () => setTimeout(load, 50));
