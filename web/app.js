// app.js — ตรรกะหน้าควบคุมการทดสอบ
const $ = (id) => document.getElementById(id);
let currentES = null;

// ไอคอน SVG ต่อชุดทดสอบ (stroke 24x24)
const ICONS = {
  smoke: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  load: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  stress: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  spike: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  soak: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  security: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  fuzz: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
};
const icon = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.smoke}</svg>`;

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json());
  $('baseUrl').value = cfg.defaultBaseUrl || '';

  const box = $('tests');
  box.innerHTML = '';
  for (const [key, t] of Object.entries(cfg.tests)) {
    const el = document.createElement('label');
    el.className = 'test-opt';
    el.innerHTML = `
      <input type="radio" name="test" value="${key}" ${key === 'smoke' ? 'checked' : ''}>
      <span class="ico">${icon(key)}</span>
      <span class="txt"><b>${t.label}</b><small>${t.note}</small></span>`;
    box.appendChild(el);
  }
  box.addEventListener('change', () => {
    const sel = document.querySelector('input[name=test]:checked');
    $('soakWrap').style.display = sel && sel.value === 'soak' ? 'block' : 'none';
  });

  const refresh = () => { $('runBtn').disabled = !$('authorized').checked; };
  $('authorized').addEventListener('change', refresh);
  refresh();

  $('runBtn').addEventListener('click', run);
}

function setStatus(cls, text) {
  const s = $('status');
  s.className = 'status ' + cls;
  $('statusText').textContent = text;
}

function appendLine(line) {
  const c = $('console');
  const span = document.createElement('span');
  let cls = '';
  if (/❌|error|ERRO|crossed|PARSE/i.test(line)) cls = 'err';
  else if (/⚠️|warn|WARN|💥/i.test(line)) cls = 'warn';
  else if (/✅|OK|✓/.test(line)) cls = 'ok';
  else if (/^\s*(คำสั่ง|▶)/.test(line)) cls = 'dim';
  span.className = cls;
  span.textContent = line + '\n';
  c.appendChild(span);
  c.scrollTop = c.scrollHeight;
}

async function run() {
  const test = (document.querySelector('input[name=test]:checked') || {}).value;
  const baseUrl = $('baseUrl').value.trim();
  const authToken = $('authToken').value.trim();
  const soakDuration = $('soakDuration').value.trim();
  const authorized = $('authorized').checked;

  if (currentES) { currentES.close(); currentES = null; }
  $('console').innerHTML = '';
  $('runBtn').disabled = true;
  setStatus('running', `กำลังรัน ${test}…`);

  let res;
  try {
    res = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test, baseUrl, authToken, soakDuration, authorized }),
    }).then((r) => r.json());
  } catch (e) {
    appendLine('❌ เชื่อมต่อ server ไม่ได้: ' + e.message);
    setStatus('fail', 'ล้มเหลว'); $('runBtn').disabled = false; return;
  }

  if (res.error) {
    appendLine('❌ ' + res.error);
    setStatus('fail', 'ถูกปฏิเสธ'); $('runBtn').disabled = false; return;
  }

  // สตรีมผลผ่าน SSE
  const es = new EventSource('/api/stream/' + res.runId);
  currentES = es;
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'line') appendLine(msg.line);
    else if (msg.type === 'done') {
      es.close(); currentES = null;
      if (msg.exitCode === 0) setStatus('done', 'เสร็จสมบูรณ์ · ดูผลที่แดชบอร์ด');
      else setStatus('fail', `จบด้วย exit ${msg.exitCode} · บันทึกผลแล้ว`);
      $('runBtn').disabled = !$('authorized').checked;
    }
  };
  es.onerror = () => {
    appendLine('(การเชื่อมต่อสตรีมปิดลง)');
    es.close(); currentES = null;
    $('runBtn').disabled = !$('authorized').checked;
  };
}

init();
