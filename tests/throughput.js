// ============================================================================
// throughput.js — หา "เพดาน req/s" ของระบบ (ยิงที่อัตราคงที่ ไต่เป็นขั้นๆ)
//   ต่างจาก stress ที่ไต่ "จำนวนผู้ใช้ (VUs)": ชุดนี้ไต่ "อัตรา request ต่อวินาที"
//   โดยตรง ด้วย ramping-arrival-rate — k6 เติม VUs ให้พอกับอัตราที่ตั้ง จึงเห็น
//   ชัดว่าระบบรับได้สูงสุดกี่ req/s ก่อนเริ่มช้า/error และเจอ rate limit (429) ที่ขั้นไหน
//
//   ⚠️ ยิงใส่ระบบของตัวเอง/ที่ได้รับอนุญาตเท่านั้น — จุดประสงค์คือ "วัดเพดาน" ไม่ใช่ทำให้ล่ม
//   k6 run -e BASE_URL=https://staging.example.com tests/throughput.js
// ============================================================================
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, PROFILES, ENDPOINTS, SUMMARY_TREND_STATS, envInt } from '../config/config.js';
import { endpointLatency, checksPassed, bizErrors, rateLimited } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

const P = PROFILES.throughput;
const startRate = envInt('START_RATE', P.startRate);
const stepRate = envInt('STEP_RATE', P.stepRate);
const steps = envInt('STEPS', P.steps);
const stageSeconds = envInt('STAGE_SEC', P.stageSeconds);

// สร้าง stage ไต่อัตราเป็นขั้นบันได: 50 → 100 → … คงแต่ละขั้น stageSeconds วินาที
const stages = [];
for (let i = 1; i <= steps; i++) {
  stages.push({ target: startRate + (i - 1) * stepRate, duration: `${stageSeconds}s` });
}

export const options = {
  scenarios: {
    throughput: {
      executor: 'ramping-arrival-rate',
      startRate: startRate,
      timeUnit: '1s',               // target = request ต่อ 1 วินาที
      preAllocatedVUs: P.preAllocVUs,
      maxVUs: P.maxVUs,             // เพดาน VUs ที่ k6 ใช้ได้ (กันเปลือง resource เครื่องยิง)
      stages,
    },
  },
  thresholds: {
    // ปล่อยให้ error เกิดได้ (จุดประสงค์คือหาจุดที่เริ่มพัง) แต่บันทึกไว้เพื่อรายงาน
    http_req_failed: ['rate<0.05'],
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { test_type: 'throughput' },
};

// ใช้ endpoint อ่านอย่างเดียว (GET) เพื่อวัด throughput โดยไม่เขียนข้อมูลจริง
const EP = ENDPOINTS.list || ENDPOINTS.home;

export default function () {
  const res = http.get(`${BASE_URL}${EP.path}`, {
    headers: DEFAULT_HEADERS,
    tags: { endpoint: 'throughput' },
  });
  endpointLatency.add(res.timings.duration, { endpoint: 'throughput' });

  if (res.status === 429) rateLimited.add(1); // โดน rate limit — เป็นพฤติกรรมที่ดี ไม่นับเป็น error

  // สำเร็จ = 2x/3xx หรือ 429 (ถูกจำกัดอัตราอย่างถูกต้อง ถือว่าระบบป้องกันตัวได้)
  const ok = check(res, {
    'status ok หรือ ถูก rate-limit': (r) => (r.status > 0 && r.status < 400) || r.status === 429,
  });
  checksPassed.add(ok);
  if (!ok) bizErrors.add(1, { endpoint: 'throughput' });
}
