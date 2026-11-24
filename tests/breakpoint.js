// ============================================================================
// breakpoint.js — หา "จุดพังจริง" ของระบบ (ไต่โหลดขึ้นจนระบบเริ่มพัง แล้วหยุดอัตโนมัติ)
//   ต่างจาก stress ที่ไต่ถึงเพดานที่ตั้งไว้แล้วจบ: ชุดนี้ไต่อัตรา req/s ขึ้นเรื่อยๆ จนถึง
//   maxRate และจะ "abort" ทันทีที่ระบบเริ่มพังจริง (p95 ช้าเกิน SLA หรือมี error จริง
//   สะสม — ไม่นับ 429 ที่เป็นการจำกัดอัตราอย่างถูกต้อง) → บอกได้ว่าเพดานจริงอยู่ตรงไหน
//
//   ⚠️ ยิงใส่ระบบของตัวเอง/ที่ได้รับอนุญาตเท่านั้น — จุดประสงค์คือ "วัดเพดานเพื่อปรับปรุง"
//      ไม่ใช่ทำให้ล่ม; เป็น load test จากเครื่องเดียว ไม่ใช่เครื่องมือ DDoS
//   k6 run -e BASE_URL=https://staging.example.com tests/breakpoint.js
// ============================================================================
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, PROFILES, ENDPOINTS, SUMMARY_TREND_STATS, envInt } from '../config/config.js';
import { endpointLatency, checksPassed, bizErrors } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

const P = PROFILES.breakpoint;
const maxRate = envInt('MAX_RATE', P.maxRate);
const rampMinutes = envInt('RAMP_MIN', P.rampMinutes);

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: P.startRate,
      timeUnit: '1s',
      preAllocatedVUs: P.preAllocVUs,
      maxVUs: P.maxVUs,
      stages: [{ target: maxRate, duration: `${rampMinutes}m` }], // ไต่จาก startRate → maxRate
    },
  },
  // abortOnFail: หยุดทั้งการทดสอบทันทีที่ข้าม threshold = เราเจอ "จุดพัง" แล้ว
  //   - latency: p95 เกิน 2 วินาที = ระบบเริ่มช้าจนใช้ไม่ได้
  //   - business_errors: error จริง (5xx/timeout, ไม่รวม 429) สะสมถึง 50 = ระบบเริ่มพัง
  thresholds: {
    http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '10s' }],
    business_errors: [{ threshold: 'count<50', abortOnFail: true }],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { test_type: 'breakpoint' },
};

const EP = ENDPOINTS.list || ENDPOINTS.home;

export default function () {
  const res = http.get(`${BASE_URL}${EP.path}`, {
    headers: DEFAULT_HEADERS,
    tags: { endpoint: 'breakpoint' },
  });
  endpointLatency.add(res.timings.duration, { endpoint: 'breakpoint' });

  // 2xx/3xx = ปกติ, 429 = ถูกจำกัดอัตรา (ระบบป้องกันตัว ไม่นับเป็นพัง)
  // error จริง (status 0 = timeout/หลุด, หรือ 5xx) → นับ business_errors เพื่อ trigger abort
  const ok = check(res, {
    'ตอบได้ (ไม่ 5xx/ไม่ timeout)': (r) => r.status > 0 && r.status < 500,
  });
  checksPassed.add(ok);
  if (!ok) bizErrors.add(1, { endpoint: 'breakpoint' });
}
