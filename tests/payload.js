// ============================================================================
// payload.js — ส่ง request body ขนาดใหญ่ขึ้นเรื่อยๆ (1KB → 10MB)
//   ตอบคำถาม: ระบบ "จำกัดขนาด body ถูกต้องไหม" — ควรตอบ 413 (Payload Too Large)
//   อย่างสุภาพ ไม่ใช่ช้าค้าง, กินแรม, หรือ 5xx/ล่ม เมื่อเจอ body ใหญ่ผิดปกติ
//
//   ⚠️ ยิงใส่ระบบของตัวเอง/ที่ได้รับอนุญาตเท่านั้น — เป็นการทดสอบความทนทาน
//      ไม่ใช่การยัด payload เพื่อทำให้ล่ม; ใช้ VU น้อยและจำนวนครั้งจำกัด
//   k6 run -e BASE_URL=https://staging.example.com tests/payload.js
// ============================================================================
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, PROFILES, ENDPOINTS, SUMMARY_TREND_STATS, envInt } from '../config/config.js';
import { endpointLatency, checksPassed, bizErrors } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

export const oversizeRejected = new Counter('oversize_rejected'); // ตอบ 413 อย่างถูกต้อง
export const bytesSent = new Trend('payload_bytes', false);       // ขนาด body ที่ส่ง (ไบต์)

const P = PROFILES.payload;
const perSize = envInt('PER_SIZE', P.perSize);
// ขนาดใหญ่สุด (MB) ปรับได้จากหน้าเว็บ; สร้างบันไดขนาดไล่ขึ้นไปจนถึงค่านั้น
const maxKB = envInt('MAX_BODY_MB', Math.round(P.sizesKB[P.sizesKB.length - 1] / 1024)) * 1024;
const LADDER = [1, 10, 100, 1024, 5120, 10240, 20480, 51200, 102400];
const sizesKB = LADDER.filter((kb) => kb < maxKB);
sizesKB.push(maxKB); // จบที่ขนาดใหญ่สุดที่เลือกเสมอ

// ลำดับการยิง: แต่ละขนาดยิงซ้ำ perSize ครั้ง เรียงจากเล็กไปใหญ่
const PLAN = [];
for (const kb of sizesKB) {
  for (let i = 0; i < perSize; i++) PLAN.push(kb);
}

export const options = {
  scenarios: {
    payload: {
      executor: 'shared-iterations',
      vus: Math.min(P.vus, PLAN.length),
      iterations: PLAN.length,
      maxDuration: '10m',
    },
  },
  thresholds: {
    // ระบบควร "ไม่ล่ม" กับ body ใหญ่ — ยอมให้ตอบ 413/4xx ได้ แต่ไม่ควร 5xx เยอะ
    'business_errors': ['count<1'],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { test_type: 'payload' },
};

// endpoint ที่รับ POST body — ใช้ create (แก้ได้ที่ config/config.js)
const EP = ENDPOINTS.create;

// สร้าง JSON body ให้ได้ขนาดใกล้เคียง targetKB (filler เป็นสตริง 'x')
function makeBody(targetKB) {
  const overheadBytes = 16; // {"data":"..."} โดยประมาณ
  const fillerBytes = Math.max(0, targetKB * 1024 - overheadBytes);
  return JSON.stringify({ data: 'x'.repeat(fillerBytes) });
}

export default function () {
  const kb = PLAN[exec.scenario.iterationInTest % PLAN.length];
  const body = makeBody(kb);
  const label = kb >= 1024 ? `${kb / 1024}MB` : `${kb}KB`;
  bytesSent.add(body.length, { size: label });

  const res = http.post(`${BASE_URL}${EP.path}`, body, {
    headers: DEFAULT_HEADERS,
    tags: { endpoint: 'payload', size: label },
    timeout: '60s', // body ใหญ่ใช้เวลาส่งนาน — กัน k6 ตัดก่อนเวลาอันควร
  });
  endpointLatency.add(res.timings.duration, { endpoint: 'payload', size: label });

  if (res.status === 413) oversizeRejected.add(1, { size: label }); // ปฏิเสธถูกต้อง = ดี

  // ดี = ตอบกลับได้อย่างเหมาะสม (2xx รับไว้ หรือ 4xx ปฏิเสธ รวมถึง 413)
  // แย่ = 5xx หรือ timeout/เชื่อมต่อหลุด (status 0) → ระบบจัดการ body ใหญ่ไม่ดี
  const ok = check(res, {
    [`${label}: ตอบกลับอย่างเหมาะสม (ไม่ 5xx/ไม่ล่ม)`]: (r) => r.status > 0 && r.status < 500,
  });
  checksPassed.add(ok);
  if (!ok) bizErrors.add(1, { endpoint: 'payload', size: label });
}
