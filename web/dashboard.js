// dashboard.js — แสดงผลรวมล่าสุดต่อชุดทดสอบ + กราฟ + ประวัติการรันจาก SQLite (reports/results.db)
const badgeText = { green: 'ผ่าน', yellow: 'เฝ้าระวัง', red: 'ต้องแก้' };
const heroIcon = {
  green: '<path d="M5 12l5 5 9-10"/>',
  yellow: '<path d="M12 8v5M12 17h.01"/>',
  red: '<path d="M6 6l12 12M18 6 6 18"/>',
};
let charts = [];
let trendChart = null;
let hist = [];          // ประวัติการรันทั้งหมดจาก DB (ใหม่สุดก่อน)

const n = (v) => (v == null ? '—' : v);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (v) => new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const ORDER = ['smoke', 'load', 'stress', 'spike', 'throughput', 'breakpoint', 'soak', 'security', 'fuzz', 'payload', 'defense'];
const typeRank = (t) => (ORDER.includes(t) ? ORDER.indexOf(t) : 99);
const TYPE_COLOR = { smoke: '#38bdf8', load: '#22C55E', stress: '#F59E0B', spike: '#a78bfa', throughput: '#2dd4bf', soak: '#f472b6' };
// ชุด "สแกน/ความทนทาน" — ไม่เอาเข้ากราฟ latency และตารางไม่โชว์ error rate (การถูกปฏิเสธคือผลดี)
const isScan = (t) => ['security', 'fuzz', 'payload', 'defense'].includes(t.type);
// breakpoint ตั้งใจดันโหลดจน latency พุ่งเพื่อหาจุดพัง → ไม่เอาเข้ากราฟเทียบ (จะบังชุดอื่น)
const inChart = (t) => !isScan(t) && t.type !== 'breakpoint';
// error rate สำหรับแสดงผล: throughput/breakpoint นับ 429 เป็นพฤติกรรมที่ดี จึงนับเฉพาะ error จริง (bizErrors)
const dispFail = (t) => (t.type === 'throughput' || t.type === 'breakpoint'
  ? (t.metrics.totalReqs ? +(((t.metrics.bizErrors || 0) / t.metrics.totalReqs) * 100).toFixed(2) : 0)
  : (t.metrics.failRate || 0));
const svg = (paths, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

async function load() {
  const [agg, h] = await Promise.all([
    fetch('/api/dashboard').then((r) => r.json()),
    fetch('/api/history').then((r) => r.json()).catch(() => ({ items: [] })),
  ]);
  hist = h.items || [];
  const meta = document.getElementById('meta');
  const content = document.getElementById('content');
  charts.forEach((c) => c.destroy());
  charts = [];
  if (trendChart) { trendChart.destroy(); trendChart = null; }

  if (!agg.tests || agg.tests.length === 0) {
    meta.textContent = '';
    content.innerHTML = `<div class="empty">
      ${svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>', 40)}
      <div>ยังไม่มีผลการทดสอบ</div>
      <a class="btn" href="/">ไปหน้าควบคุมเพื่อเริ่มทดสอบ</a>
    </div>`;
    return;
  }

  meta.innerHTML = `เป้าหมาย <b>${esc(agg.baseUrl)}</b> · อัปเดต ${new Date(agg.generatedAt).toLocaleString('th-TH')}`
    + ` · ข้อมูลจาก <code>reports/results.db</code> (${hist.length.toLocaleString()} การรัน)`;

  // นับผลตามสี สำหรับ chip ใน hero
  const count = { green: 0, yellow: 0, red: 0 };
  agg.tests.forEach((t) => { count[t.color]++; });
  const chip = (c) => `<span class="chip ${count[c] ? c : 'zero'}">${badgeText[c]} ${count[c]}</span>`;

  // KPI รวม — ชุดโหลดที่เอามาเทียบกราฟ/หาค่าสูงสุด (ไม่รวม breakpoint ที่ตั้งใจดันจนพัง)
  const loadTests = agg.tests.filter((t) => inChart(t));
  const worstP95 = Math.max(0, ...loadTests.map((t) => t.metrics.p95 || 0));
  const worstErr = Math.max(0, ...loadTests.map((t) => dispFail(t)));
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
    </div>

    <div class="row section-row">
      <h3 class="section-h">ประวัติการรันทั้งหมด <span class="dim">· จากฐานข้อมูล</span></h3>
      <div class="spacer"></div>
      <label class="inline" for="histType">ชุดทดสอบ</label>
      <select id="histType" class="compact">
        <option value="">ทั้งหมด</option>
        ${[...new Map(hist.map((x) => [x.type, x.label || x.type])).entries()]
          .sort(([a], [b]) => typeRank(a) - typeRank(b))
          .map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}
      </select>
    </div>
    <div class="chart-box trend" id="trendBox">
      <h3 id="trendTitle">แนวโน้ม p95 ตามเวลา (ms)</h3>
      <div class="canvas"><canvas id="trendChart"></canvas></div>
    </div>
    <div class="table-wrap hist-wrap">
      <table id="histTbl">
        <thead><tr>
          <th>รันเมื่อ</th><th>ชุดทดสอบ</th><th>สถานะ</th><th>เป้าหมาย</th><th class="num">Requests</th>
          <th class="num">p95</th><th class="num">p99</th><th class="num">Error</th><th class="num">Peak VUs</th><th class="num">Checks/พบ</th>
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
      : t.type === 'payload'
      ? `<span><b>${m.bizErrors}</b>crash/5xx</span><span><b>${m.oversizeRejected}</b>ปฏิเสธ 413</span><span><b>${m.totalReqs}</b>ครั้งที่ยิง</span>`
      : t.type === 'throughput'
      ? `<span><b>${n(m.rps)}</b>req/s เฉลี่ย</span><span><b>${m.rateLimited}</b>โดน 429</span><span><b>${n(m.p95)}</b>p95 ms</span>`
      : t.type === 'breakpoint'
      ? `<span><b>${m.maxVus}</b>VUs เพดาน</span><span><b>${n(m.p95)}</b>p95 ms</span><span><b>${m.bizErrors}</b>error จริง</span>`
      : t.type === 'defense'
      ? `<span><b>${m.rateLimited}</b>จำกัด 429/503</span><span><b>${m.bizErrors}</b>ล่ม/5xx</span><span><b>${n(m.rps)}</b>req/s</span>`
      : `<span><b>${n(m.p95)}</b>p95 ms</span><span><b>${n(dispFail(t))}%</b>error</span><span><b>${m.maxVus}</b>VUs</span>`;
    const d = document.createElement('div');
    d.className = 'card ' + t.color;
    d.innerHTML = `<div class="top"><div class="h">${esc(t.label)}</div><span class="badge ${esc(t.color)}">${badgeText[t.color]}</span></div>
      <div class="msg">${esc(t.verdict)}</div><div class="mini">${mini}</div>`;
    cards.appendChild(d);
  }

  // ตาราง — ชุด security/fuzz ไม่แสดง error rate เพราะการถูกปฏิเสธ (4xx) คือผลที่ดี ไม่ใช่ความล้มเหลว
  const tb = document.querySelector('#tbl tbody');
  for (const t of agg.tests) {
    const m = t.metrics;
    const last = t.type === 'security' ? m.securityFindings
      : (t.type === 'fuzz' || t.type === 'payload') ? m.bizErrors
      : t.type === 'defense' ? m.rateLimited
      : (m.checkRate != null ? m.checkRate + '%' : '—');
    const err = isScan(t) ? '<span class="na">—</span>' : `${n(dispFail(t))}%`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${esc(t.label)}</b></td><td class="dot ${esc(t.color)}"aria-label="${badgeText[t.color]}"></td>
      <td class="num">${m.totalReqs.toLocaleString()}</td><td class="num">${n(m.rps)}</td>
      <td class="num">${n(m.avg)}</td><td class="num">${n(m.p95)}</td><td class="num">${n(m.p99)}</td><td class="num">${n(m.max)}</td>
      <td class="num">${err}</td><td class="num">${m.maxVus}</td><td class="num">${last}</td>
      <td>${new Date(t.ranAt).toLocaleString('th-TH')}</td>`;
    tb.appendChild(tr);
  }

  document.getElementById('histType').addEventListener('change', renderHistory);

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
      data: { labels, datasets: [{ label: 'error %', data: loadTests.map((t) => dispFail(t)), ...bar,
        backgroundColor: loadTests.map((t) => (dispFail(t) >= 5 ? '#EF4444' : dispFail(t) >= 1 ? '#F59E0B' : '#22C55E')) }] },
      options: opts({ plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, suggestedMax: 5, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } } }),
    }));
  }
  renderHistory();
}

// ประวัติจาก DB: ตาราง + กราฟแนวโน้ม (กรองตามชุดทดสอบได้)
function renderHistory() {
  const sel = document.getElementById('histType').value;
  const rows = sel ? hist.filter((x) => x.type === sel) : hist;

  const tb = document.querySelector('#histTbl tbody');
  tb.innerHTML = rows.length ? '' : '<tr><td colspan="10" class="na">ไม่มีข้อมูล</td></tr>';
  for (const x of rows) {
    const m = x.metrics || {};
    const scan = isScan(x);
    const last = x.type === 'security' ? n(m.securityFindings)
      : (x.type === 'fuzz' || x.type === 'payload') ? n(m.bizErrors)
      : x.type === 'defense' ? n(m.rateLimited)
      : (m.checkRate != null ? m.checkRate + '%' : '—');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtTime(x.ranAt)}</td><td><b>${esc(x.label || x.type)}</b></td>
      <td class="dot ${esc(x.color)}" aria-label="${badgeText[x.color] || ''}" title="${esc(x.verdict)}"></td>
      <td class="url" title="${esc(x.baseUrl)}">${esc(x.baseUrl) || '<span class="na">—</span>'}</td>
      <td class="num">${(m.totalReqs || 0).toLocaleString()}</td>
      <td class="num">${scan ? '<span class="na">—</span>' : n(m.p95)}</td><td class="num">${scan ? '<span class="na">—</span>' : n(m.p99)}</td>
      <td class="num">${scan ? '<span class="na">—</span>' : n(dispFail(x)) + '%'}</td>
      <td class="num">${n(m.maxVus)}</td><td class="num">${last}</td>`;
    tb.appendChild(tr);
  }

  // กราฟแนวโน้ม: เฉพาะชุดโหลด (security/fuzz ไม่มี latency ที่มีความหมาย) และต้องมีอย่างน้อย 2 จุด
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  const pts = rows.filter((x) => inChart(x) && x.metrics && x.metrics.p95 != null).slice().reverse(); // เก่า → ใหม่
  const box = document.getElementById('trendBox');
  box.style.display = window.Chart && pts.length >= 2 ? '' : 'none';
  if (box.style.display) return;

  const labels = pts.map((x) => fmtTime(x.ranAt));
  const line = { tension: 0.25, pointRadius: 3, spanGaps: true, borderWidth: 2 };
  let datasets;
  if (sel) {
    document.getElementById('trendTitle').textContent = 'แนวโน้ม p95 / p99 ตามเวลา (ms)';
    datasets = [
      { label: 'p95', data: pts.map((x) => x.metrics.p95), borderColor: '#38bdf8', backgroundColor: '#38bdf8', ...line },
      { label: 'p99', data: pts.map((x) => x.metrics.p99), borderColor: '#0369a1', backgroundColor: '#0369a1', ...line },
    ];
  } else {
    document.getElementById('trendTitle').textContent = 'แนวโน้ม p95 ตามเวลา แยกตามชุด (ms)';
    datasets = [...new Set(pts.map((x) => x.type))].map((t) => ({
      label: (pts.find((x) => x.type === t) || {}).label || t,
      data: pts.map((x) => (x.type === t ? x.metrics.p95 : null)),
      borderColor: TYPE_COLOR[t] || '#94A3B8', backgroundColor: TYPE_COLOR[t] || '#94A3B8', ...line,
    }));
  }
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
      scales: { y: { beginAtZero: true }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } } } },
  });
}

document.getElementById('refreshBtn').addEventListener('click', load);
// รอ Chart.js (defer) โหลดเสร็จก่อนค่อยวาด
window.addEventListener('DOMContentLoaded', () => setTimeout(load, 50));
