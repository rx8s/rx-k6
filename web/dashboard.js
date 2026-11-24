// dashboard.js — แสดงผลรวมล่าสุดต่อชุดทดสอบ + กราฟ
const badgeText = { green: 'ผ่าน', yellow: 'เฝ้าระวัง', red: 'ต้องแก้' };
const heroIcon = {
  green: '<path d="M5 12l5 5 9-10"/>',
  yellow: '<path d="M12 8v5M12 17h.01"/>',
  red: '<path d="M6 6l12 12M18 6 6 18"/>',
};
let charts = [];

const n = (v) => (v == null ? '—' : v);
const isScan = (t) => t.type === 'security' || t.type === 'fuzz';
const svg = (paths, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

async function load() {
  const agg = await fetch('/api/dashboard').then((r) => r.json());
  const meta = document.getElementById('meta');
  const content = document.getElementById('content');
  charts.forEach((c) => c.destroy());
  charts = [];

  if (!agg.tests || agg.tests.length === 0) {
    meta.textContent = '';
    content.innerHTML = `<div class="empty">
      ${svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>', 40)}
      <div>ยังไม่มีผลการทดสอบ</div>
      <a class="btn" href="/">ไปหน้าควบคุมเพื่อเริ่มทดสอบ</a>
    </div>`;
    return;
  }

  meta.innerHTML = `เป้าหมาย <b>${agg.baseUrl}</b> · อัปเดต ${new Date(agg.generatedAt).toLocaleString('th-TH')}`;

  // นับผลตามสี สำหรับ chip ใน hero
  const count = { green: 0, yellow: 0, red: 0 };
  agg.tests.forEach((t) => { count[t.color]++; });
  const chip = (c) => `<span class="chip ${count[c] ? c : 'zero'}">${badgeText[c]} ${count[c]}</span>`;

  // KPI รวม
  const loadTests = agg.tests.filter((t) => !isScan(t));
  const worstP95 = Math.max(0, ...loadTests.map((t) => t.metrics.p95 || 0));
  const worstErr = Math.max(0, ...loadTests.map((t) => t.metrics.failRate || 0));
  const peakVus = Math.max(0, ...agg.tests.map((t) => t.metrics.maxVus || 0));
  const totalReq = agg.tests.reduce((s, t) => s + (t.metrics.totalReqs || 0), 0);
  const sec = agg.tests.find((t) => t.type === 'security');
  const fuzz = agg.tests.find((t) => t.type === 'fuzz');
  const secFindings = sec ? sec.metrics.securityFindings : '—';
  const fuzzErr = fuzz ? fuzz.metrics.bizErrors : '—';

  const errCls = !loadTests.length ? '' : worstErr >= 5 ? 'red' : worstErr >= 1 ? 'yellow' : 'green';
  const secCls = sec ? (secFindings > 0 ? 'red' : 'green') : '';
  const fuzzCls = fuzz ? (fuzzErr > 0 ? 'yellow' : 'green') : '';

  content.innerHTML = `
    <div class="hero ${agg.worst}">
      <div class="hero-light">${svg(heroIcon[agg.worst])}</div>
      <div class="hero-body">
        <div class="hero-k">ผลโดยรวม · ${agg.tests.length} ชุดทดสอบ</div>
        <div class="hero-v">${agg.overall}</div>
        <div class="chips">${chip('green')}${chip('yellow')}${chip('red')}</div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi"><div class="k">p95 สูงสุด (โหลด)</div><div class="v">${loadTests.length ? worstP95 : '—'} <small>ms</small></div></div>
      <div class="kpi"><div class="k">Error สูงสุด (โหลด)</div><div class="v ${errCls}">${loadTests.length ? worstErr + '%' : '—'}</div></div>
      <div class="kpi"><div class="k">Peak VUs</div><div class="v">${peakVus}</div></div>
      <div class="kpi"><div class="k">Requests รวม</div><div class="v">${totalReq.toLocaleString()}</div></div>
      <div class="kpi"><div class="k">ช่องโหว่ที่พบ</div><div class="v ${secCls}">${secFindings}</div></div>
      <div class="kpi"><div class="k">Fuzz crash</div><div class="v ${fuzzCls}">${fuzzErr}</div></div>
    </div>

    <div class="cards" id="cards"></div>

    ${loadTests.length ? `<div class="charts">
      <div class="chart-box"><h3>เวลาตอบสนอง p95 / p99 (ms)</h3><div class="canvas"><canvas id="latChart"></canvas></div></div>
      <div class="chart-box"><h3>Error rate (%)</h3><div class="canvas"><canvas id="errChart"></canvas></div></div>
    </div>` : ''}

    <h3 class="section-h">ตารางตัวชี้วัดละเอียด</h3>
    <div class="table-wrap">
      <table id="tbl">
        <thead><tr>
          <th>ชุดทดสอบ</th><th>สถานะ</th><th class="num">Requests</th><th class="num">req/s</th>
          <th class="num">avg</th><th class="num">p95</th><th class="num">p99</th><th class="num">max</th>
          <th class="num">Error</th><th class="num">Peak VUs</th><th class="num">Checks/พบ</th><th>รันเมื่อ</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  // การ์ดรายชุด
  const cards = document.getElementById('cards');
  for (const t of agg.tests) {
    const m = t.metrics;
    const mini = t.type === 'security'
      ? `<span><b>${m.securityFindings}</b>ช่องโหว่</span><span><b>${m.checkPass}</b>ตรวจผ่าน</span>`
      : t.type === 'fuzz'
      ? `<span><b>${m.bizErrors}</b>crash/5xx</span><span><b>${m.totalReqs}</b>input ที่ยิง</span>`
      : `<span><b>${n(m.p95)}</b>p95 ms</span><span><b>${n(m.failRate)}%</b>error</span><span><b>${m.maxVus}</b>VUs</span>`;
    const d = document.createElement('div');
    d.className = 'card ' + t.color;
    d.innerHTML = `<div class="top"><div class="h">${t.label}</div><span class="badge ${t.color}">${badgeText[t.color]}</span></div>
      <div class="msg">${t.verdict}</div><div class="mini">${mini}</div>`;
    cards.appendChild(d);
  }

  // ตาราง — ชุด security/fuzz ไม่แสดง error rate เพราะการถูกปฏิเสธ (4xx) คือผลที่ดี ไม่ใช่ความล้มเหลว
  const tb = document.querySelector('#tbl tbody');
  for (const t of agg.tests) {
    const m = t.metrics;
    const last = t.type === 'security' ? m.securityFindings : t.type === 'fuzz' ? m.bizErrors : (m.checkRate != null ? m.checkRate + '%' : '—');
    const err = isScan(t) ? '<span class="na">—</span>' : `${n(m.failRate)}%`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${t.label}</b></td><td class="dot ${t.color}" aria-label="${badgeText[t.color]}"></td>
      <td class="num">${m.totalReqs.toLocaleString()}</td><td class="num">${n(m.rps)}</td>
      <td class="num">${n(m.avg)}</td><td class="num">${n(m.p95)}</td><td class="num">${n(m.p99)}</td><td class="num">${n(m.max)}</td>
      <td class="num">${err}</td><td class="num">${m.maxVus}</td><td class="num">${last}</td>
      <td>${new Date(t.ranAt).toLocaleString('th-TH')}</td>`;
    tb.appendChild(tr);
  }

  // กราฟ (เฉพาะชุดโหลดที่มี latency)
  if (window.Chart && loadTests.length) {
    const labels = loadTests.map((t) => t.label);
    // ธีม dark ให้กราฟ: ตัวอักษร/เส้น grid อ่านออกบนพื้นเข้ม
    Chart.defaults.color = '#94A3B8';
    Chart.defaults.borderColor = '#2B3750';
    Chart.defaults.font.family = "'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif";
    const bar = { borderRadius: 6, maxBarThickness: 48 };
    const opts = (extra) => ({ responsive: true, maintainAspectRatio: false, ...extra });
    charts.push(new Chart(document.getElementById('latChart'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'p95', data: loadTests.map((t) => t.metrics.p95 || 0), backgroundColor: '#38bdf8', ...bar },
        { label: 'p99', data: loadTests.map((t) => t.metrics.p99 || 0), backgroundColor: '#0369a1', ...bar },
      ]},
      options: opts({ plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
        scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }),
    }));
    charts.push(new Chart(document.getElementById('errChart'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'error %', data: loadTests.map((t) => t.metrics.failRate || 0), ...bar,
        backgroundColor: loadTests.map((t) => (t.metrics.failRate >= 5 ? '#EF4444' : t.metrics.failRate >= 1 ? '#F59E0B' : '#22C55E')) }] },
      options: opts({ plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, suggestedMax: 5, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } } }),
    }));
  }
}

document.getElementById('refreshBtn').addEventListener('click', load);
// รอ Chart.js (defer) โหลดเสร็จก่อนค่อยวาด
window.addEventListener('DOMContentLoaded', () => setTimeout(load, 50));
