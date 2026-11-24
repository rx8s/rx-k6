// ============================================================================
// soak.js — รันโหลดปานกลางเป็นเวลานาน เพื่อหา memory leak / การเสื่อมสะสม
//   ตอบคำถาม: ระบบ "อยู่ได้ยาวๆ" โดยไม่ช้าลงหรือกินแรมเพิ่มเรื่อยๆ ไหม
//   ปรับเวลาได้ด้วย -e DURATION=2h (หรือผ่านหน้าเว็บ)
// ============================================================================
import { sleep } from 'k6';
import { PROFILES, THRESHOLDS, ENDPOINTS, SUMMARY_TREND_STATS, envInt, envStr } from '../config/config.js';
import { callEndpoint, thinkTime } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  vus: envInt('VUS', PROFILES.soak.vus),
  duration: envStr('DURATION', envStr('SOAK_DURATION', PROFILES.soak.duration)), // SOAK_DURATION: รองรับของเดิม
  thresholds: THRESHOLDS, // ที่โหลดคงที่ ควรผ่าน SLA ตลอด; ถ้าค่อยๆ แย่ลง = มีปัญหาสะสม
  summaryTrendStats: SUMMARY_TREND_STATS,
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
