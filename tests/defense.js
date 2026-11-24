// ============================================================================
// defense.js — ตรวจว่า "เกราะกันโจมตี" ของระบบทำงานจริงไหม (ยิงหนักคงที่แล้วดูการป้องกัน)
//   จำลองทราฟฟิกหนักแบบโจมตี (อัตราคงที่สูง) แล้วเช็กว่าระบบ "ป้องกันตัวเอง" ได้ไหม:
//     - ดี  = จำกัดอัตราด้วย 429 หรือ 503 (rate limit / load shedding) โดยไม่ล่ม
//     - ควรดู = ปล่อยผ่านทั้งหมด (ไม่เห็นการจำกัด) → อาจไม่มีเกราะกัน DDoS
//     - แย่ = ตอบ 5xx จริง / timeout / ล่ม → เกราะรับโหลดหนักไม่ไหว
//
//   ⚠️ ยิงใส่ระบบของตัวเอง/ที่ได้รับอนุญาตเท่านั้น — จุดประสงค์คือ "ยืนยันว่าเกราะทำงาน"
//      ไม่ใช่เจาะให้ล่ม; เป็น load test จากเครื่องเดียว ไม่ใช่เครื่องมือ DDoS แบบกระจาย
//   k6 run -e BASE_URL=https://staging.example.com tests/defense.js
// ============================================================================
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, PROFILES, ENDPOINTS, SUMMARY_TREND_STATS, envInt } from '../config/config.js';
import { endpointLatency, checksPassed, bizErrors, rateLimited } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

const P = PROFILES.defense;
const rate = envInt('RATE', P.rate);
const seconds = envInt('SECONDS', P.seconds);

export const options = {
  scenarios: {
    defense: {
      executor: 'constant-arrival-rate',
      rate: rate,
      timeUnit: '1s',             // rate = request ต่อวินาที (คงที่)
      duration: `${seconds}s`,
      preAllocatedVUs: P.preAllocVUs,
      maxVUs: P.maxVUs,
    },
  },
  thresholds: {
    // เกราะที่ดีต้อง "ไม่ล่ม" ภายใต้โหลดหนัก — error จริง (5xx/timeout) ต้องเป็น 0
    business_errors: ['count<1'],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { test_type: 'defense' },
};

const EP = ENDPOINTS.list || ENDPOINTS.home;

export default function () {
  const res = http.get(`${BASE_URL}${EP.path}`, {
    headers: DEFAULT_HEADERS,
    tags: { endpoint: 'defense' },
  });
  endpointLatency.add(res.timings.duration, { endpoint: 'defense' });

  // 429 / 503 = ระบบกำลังป้องกันตัว (จำกัดอัตรา / ปฏิเสธโหลดส่วนเกิน) = พฤติกรรมที่ดี
  const defended = res.status === 429 || res.status === 503;
  if (defended) rateLimited.add(1);

  // error จริง = 5xx อื่น (500/502/504) หรือ status 0 (timeout/เชื่อมต่อหลุด) → เกราะไม่ไหว
  const realFail = res.status === 0 || (res.status >= 500 && res.status !== 503);

  const ok = check(res, {
    'ไม่ล่ม (ตอบ 2xx, หรือถูกจำกัด 429/503)': () => !realFail,
  });
  checksPassed.add(ok);
  if (realFail) bizErrors.add(1, { endpoint: 'defense' });
}
