// ============================================================================
// security.js — ยิง payload แบบ OWASP เข้าช่อง input ของระบบ "ตัวเอง"
//   เพื่อดูว่าระบบ ป้องกัน/กรอง ได้หรือไม่ (พบ = ควรปรับปรุง)
//
//   ⚠️ ใช้กับระบบที่คุณเป็นเจ้าของหรือได้รับอนุญาตเป็นลายลักษณ์อักษรเท่านั้น
//   payload เป็นชุด "ตรวจจับ" มาตรฐาน ไม่ได้ออกแบบมาทำลายข้อมูล
//   รันด้วย 1 VU ไม่เป็น DoS — จุดประสงค์คือตรวจความปลอดภัย ไม่ใช่ถล่มโหลด
//
//   k6 run -e BASE_URL=https://staging.example.com tests/security.js
// ============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEFAULT_HEADERS } from '../config/config.js';
import { SECURITY_SUITES, LEAK_SIGNATURES } from '../lib/payloads.js';
import { securityHits } from '../lib/helpers.js';
const endpointsData = JSON.parse(open('../scenarios/endpoints.json'));

export { handleSummary } from '../lib/summary.js';

export const options = {
  vus: 1,            // สแกน ไม่ใช่โหลด — ยิงทีละรายการ
  iterations: 1,     // วนครบทุก payload รอบเดียว
  tags: { test_type: 'security' },
};

// ตรวจว่า response มีร่องรอยช่องโหว่ไหม
function looksVulnerable(res, payload) {
  // 1) error/ข้อมูลภายในรั่วออกมาใน body
  const body = (res.body || '').toString();
  for (const sig of LEAK_SIGNATURES) {
    if (body.includes(sig)) return { vuln: true, reason: `พบ signature รั่ว: "${sig}"` };
  }
  // 2) payload สะท้อนกลับมาแบบไม่ถูก encode (เสี่ยง XSS)
  if (payload.includes('<script>') && body.includes('<script>')) {
    return { vuln: true, reason: 'payload XSS สะท้อนกลับโดยไม่ถูก encode' };
  }
  // 3) 500 — input ทำให้ระบบ error แทนที่จะ reject อย่างสุภาพ (400/422)
  if (res.status >= 500) {
    return { vuln: true, reason: `ตอบ ${res.status} (ควร reject เป็น 4xx แทน)` };
  }
  // 4) time-based: ตอบช้าผิดปกติกับ payload หน่วงเวลา
  if (/sleep|WAITFOR|DELAY/i.test(payload) && res.timings.duration > 4500) {
    return { vuln: true, reason: `response ช้าผิดปกติ (${res.timings.duration.toFixed(0)}ms) — อาจมี time-based injection` };
  }
  return { vuln: false };
}

function injectInto(ep, field, payload) {
  const params = { headers: DEFAULT_HEADERS, tags: { endpoint: ep.name, attack: 'security' } };

  if (field === 'path') {
    const path = ep.path.replace('{INJECT}', encodeURIComponent(payload));
    return http.request(ep.method, `${BASE_URL}${path}`, null, params);
  }

  if (ep.method === 'GET') {
    const q = {};
    for (const [k, v] of Object.entries(ep.query || {})) {
      q[k] = k === field ? payload : v.replace('{INJECT}', 'x');
    }
    const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return http.get(`${BASE_URL}${ep.path}?${qs}`, params);
  }

  // POST/PUT: ยัด payload ลง field ที่ระบุ
  const body = {};
  for (const [k, v] of Object.entries(ep.body || {})) {
    body[k] = k === field ? payload : (typeof v === 'string' ? v.replace('{INJECT}', 'x') : v);
  }
  return http.request(ep.method, `${BASE_URL}${ep.path}`, JSON.stringify(body), params);
}

export default function () {
  console.log(`🔍 เริ่มสแกนความปลอดภัยที่ ${BASE_URL}`);
  let total = 0, flagged = 0;

  for (const ep of endpointsData.endpoints) {
    for (const field of ep.injectable || []) {
      for (const [suiteName, payloads] of Object.entries(SECURITY_SUITES)) {
        for (const payload of payloads) {
          const res = injectInto(ep, field, payload);
          total++;
          const verdict = looksVulnerable(res, payload);

          check(res, {
            [`${ep.name}.${field} [${suiteName}] ป้องกันได้`]: () => !verdict.vuln,
          });

          if (verdict.vuln) {
            flagged++;
            securityHits.add(1, { endpoint: ep.name, field, suite: suiteName });
            console.warn(`⚠️  [${suiteName}] ${ep.name}.${field} — ${verdict.reason}`);
            console.warn(`    payload: ${String(payload).slice(0, 60)}`);
          }
          sleep(0.2); // สุภาพกับระบบ ไม่ถล่ม
        }
      }
    }
  }

  console.log(`✅ สแกนเสร็จ: ยิงทั้งหมด ${total} ครั้ง, พบจุดน่าสงสัย ${flagged} จุด`);
}
