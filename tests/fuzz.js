// ============================================================================
// fuzz.js — ยิง input ผิดรูปแบบ/ค่าขอบเขต เพื่อดูว่า validation + error handling ทน
//   เป้าหมาย: ระบบควรตอบ 4xx อย่างสุภาพ ไม่ใช่ 500 หรือ crash
//
//   k6 run -e BASE_URL=https://staging.example.com tests/fuzz.js
// ============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEFAULT_HEADERS } from '../config/config.js';
import { FUZZ_VALUES } from '../lib/payloads.js';
import { bizErrors } from '../lib/helpers.js';
const endpointsData = JSON.parse(open('../scenarios/endpoints.json'));

export { handleSummary } from '../lib/summary.js';

export const options = {
  vus: 1,
  iterations: 1,
  tags: { test_type: 'fuzz' },
};

export default function () {
  console.log(`🧪 เริ่ม fuzzing ที่ ${BASE_URL}`);
  let total = 0, crashed = 0;

  for (const ep of endpointsData.endpoints) {
    for (const field of ep.injectable || []) {
      for (const val of FUZZ_VALUES) {
        const params = { headers: DEFAULT_HEADERS, tags: { endpoint: ep.name, attack: 'fuzz' } };
        let res;

        if (field === 'path') {
          const path = ep.path.replace('{INJECT}', encodeURIComponent(String(val)));
          res = http.request(ep.method, `${BASE_URL}${path}`, null, params);
        } else if (ep.method === 'GET') {
          const qs = Object.keys(ep.query || {})
            .map((k) => `${k}=${encodeURIComponent(k === field ? String(val) : 'x')}`)
            .join('&');
          res = http.get(`${BASE_URL}${ep.path}?${qs}`, params);
        } else {
          const body = {};
          for (const k of Object.keys(ep.body || {})) body[k] = k === field ? val : 'x';
          res = http.request(ep.method, `${BASE_URL}${ep.path}`, JSON.stringify(body), params);
        }

        total++;
        // ระบบที่ดี: reject เป็น 4xx. ไม่ดี: 500/503 หรือตอบไม่ได้ (status 0)
        const graceful = check(res, {
          [`${ep.name}.${field}: จัดการ input แปลกได้ (ไม่ 5xx/crash)`]:
            (r) => r.status !== 0 && r.status < 500,
        });

        if (!graceful) {
          crashed++;
          bizErrors.add(1, { endpoint: ep.name, field });
          console.warn(`💥 ${ep.name}.${field} ตอบ ${res.status} กับค่า: ${JSON.stringify(val).slice(0, 50)}`);
        }
        sleep(0.1);
      }
    }
  }

  console.log(`✅ fuzzing เสร็จ: ยิง ${total} ครั้ง, เจอ crash/5xx ${crashed} ครั้ง`);
}
