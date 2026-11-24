// ============================================================================
// config.js — ค่ากลางของทั้งเฟรมเวิร์ก
// ----------------------------------------------------------------------------
// ปรับเป้าหมายและพารามิเตอร์ได้ที่นี่ หรือส่งผ่าน env ตอนรัน เช่น:
//   k6 run -e BASE_URL=https://staging.example.com tests/load.js
// ============================================================================

// เป้าหมายที่จะทดสอบ — ดีฟอลต์เป็น localhost เพื่อกันการยิงระบบคนอื่นโดยไม่ตั้งใจ
// ⚠️ ทดสอบได้เฉพาะระบบที่คุณเป็นเจ้าของ/ได้รับอนุญาตเท่านั้น
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// token สำหรับ auth (ถ้าระบบต้องล็อกอิน) — ส่งผ่าน -e AUTH_TOKEN=xxx
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

// header เริ่มต้นที่แนบไปทุก request
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'rx-k6-sim/1.0 (authorized-testing)',
  ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
};

// ----------------------------------------------------------------------------
// เกณฑ์ผ่าน/ไม่ผ่าน (thresholds) — ใช้สรุปใน exec report ว่า "ผ่าน SLA" หรือไม่
// ----------------------------------------------------------------------------
export const THRESHOLDS = {
  http_req_failed: ['rate<0.01'],          // error rate ต้องต่ำกว่า 1%
  http_req_duration: ['p(95)<800', 'p(99)<1500'], // p95 < 800ms, p99 < 1.5s
};

// สถิติที่ส่งออกใน summary — ค่าเริ่มต้นของ k6 ไม่มี p(99) รายงาน/แดชบอร์ดจึงว่าง
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

// ความเข้มของแต่ละ profile — ปรับตามขนาดระบบจริง เริ่มต้นไว้แบบอนุรักษ์นิยม
export const PROFILES = {
  smoke:  { vus: 1,   duration: '30s' },                 // ตรวจว่าใช้งานได้ก่อน
  load:   { vus: 50,  duration: '5m'  },                 // โหลดปกติที่คาดหวัง
  stress: { startVus: 0, maxVus: 300, rampMinutes: 10 }, // ค่อยๆ เพิ่มหาจุดพัง
  spike:  { baseVus: 20, peakVus: 500 },                 // พุ่งทันทีแล้วลด
  soak:   { vus: 40,  duration: '1h'  },                 // รันยาวหา memory leak
};

// endpoint ที่จะทดสอบ — แก้เป็นของระบบคุณ (ดู scenarios/endpoints.json ด้วย)
export const ENDPOINTS = {
  health:   { method: 'GET',  path: '/health' },
  home:     { method: 'GET',  path: '/' },
  list:     { method: 'GET',  path: '/api/items' },
  detail:   { method: 'GET',  path: '/api/items/1' },
  create:   { method: 'POST', path: '/api/items', body: { name: 'load-test-item' } },
  login:    { method: 'POST', path: '/api/login', body: { username: 'test', password: 'test' } },
};
