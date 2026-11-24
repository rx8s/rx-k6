// ============================================================================
// smoke.js — ทดสอบเบาๆ 1 VU เพื่อเช็กว่าระบบ "ตอบได้" ก่อนรันของจริง
//   รันอันนี้ก่อนเสมอ เพื่อยืนยันว่า BASE_URL/endpoint ถูกต้อง
// ============================================================================
import { sleep } from 'k6';
import { PROFILES, ENDPOINTS } from '../config/config.js';
import { callEndpoint } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  vus: PROFILES.smoke.vus,
  duration: PROFILES.smoke.duration,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks_passed: ['rate>0.95'],
  },
  tags: { test_type: 'smoke' },
};

export default function () {
  for (const [name, ep] of Object.entries(ENDPOINTS)) {
    callEndpoint(ep, name);
    sleep(1);
  }
}
