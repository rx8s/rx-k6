// ============================================================================
// soak.js — รันโหลดปานกลางเป็นเวลานาน เพื่อหา memory leak / การเสื่อมสะสม
//   ตอบคำถาม: ระบบ "อยู่ได้ยาวๆ" โดยไม่ช้าลงหรือกินแรมเพิ่มเรื่อยๆ ไหม
//   ปรับเวลาได้ด้วย -e SOAK_DURATION=2h
// ============================================================================
import { sleep } from 'k6';
import { PROFILES, THRESHOLDS, ENDPOINTS } from '../config/config.js';
import { callEndpoint, thinkTime } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

const duration = __ENV.SOAK_DURATION || PROFILES.soak.duration;

export const options = {
  vus: PROFILES.soak.vus,
  duration: duration,
  thresholds: THRESHOLDS, // ที่โหลดคงที่ ควรผ่าน SLA ตลอด; ถ้าค่อยๆ แย่ลง = มีปัญหาสะสม
  tags: { test_type: 'soak' },
};

export default function () {
  callEndpoint(ENDPOINTS.home, 'home');
  sleep(thinkTime());
  callEndpoint(ENDPOINTS.list, 'list');
  sleep(thinkTime());
  callEndpoint(ENDPOINTS.detail, 'detail');
  sleep(thinkTime());
}
