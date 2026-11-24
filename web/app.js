// app.js — ตรรกะหน้าควบคุมการทดสอบ
const $ = (id) => document.getElementById(id);
let currentES = null;

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
      <span>${t.label}</span>
      <span class="note">${t.note}</span>`;
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
