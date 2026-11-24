// ============================================================================
// spike.js — traffic พุ่งทันทีแล้วหายไป (เช่น โปรโมชัน/ข่าวดัง/ยิงถล่มช่วงสั้น)
//   ตอบคำถาม: ระบบ "รอดและฟื้นตัว" จาก spike กะทันหันได้ไหม
// ============================================================================
import { sleep } from 'k6';
import { PROFILES, ENDPOINTS, SUMMARY_TREND_STATS, envInt } from '../config/config.js';
import { callEndpoint } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

const baseVus = envInt('BASE_VUS', PROFILES.spike.baseVus);
const peakVus = envInt('PEAK_VUS', PROFILES.spike.peakVus);

export const options = {
  stages: [
    { duration: '1m', target: baseVus },   // ช่วงปกติ
    { duration: '30s', target: peakVus },  // พุ่งทันที
    { duration: '1m', target: peakVus },   // ค้างที่จุดพีค
    { duration: '30s', target: baseVus },  // ลดกลับ
    { duration: '2m', target: baseVus },   // ดูว่าฟื้นตัวดีไหมหลัง spike
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'], // ยอมให้พลาดได้ถึง 5% ช่วง spike
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { test_type: 'spike' },
};

export default function () {
  callEndpoint(ENDPOINTS.home, 'home');
  callEndpoint(ENDPOINTS.list, 'list');
  sleep(0.5);
}
