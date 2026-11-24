// ============================================================================
// load.js — ทดสอบโหลดปกติ (ผู้ใช้จำนวนคงที่ตามที่คาดหวัง)
//   k6 run -e BASE_URL=https://staging.example.com tests/load.js
// ============================================================================
import { sleep } from 'k6';
import { THRESHOLDS, PROFILES, ENDPOINTS, SUMMARY_TREND_STATS, envInt, envStr } from '../config/config.js';
import { callEndpoint, thinkTime } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

export const options = {
  vus: envInt('VUS', PROFILES.load.vus),
  duration: envStr('DURATION', PROFILES.load.duration),
  thresholds: THRESHOLDS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { test_type: 'load' },
};

export default function () {
  // จำลอง journey ของผู้ใช้หนึ่งคน
  callEndpoint(ENDPOINTS.home, 'home');
  sleep(thinkTime());
  callEndpoint(ENDPOINTS.list, 'list');
  sleep(thinkTime());
  callEndpoint(ENDPOINTS.detail, 'detail');
  sleep(thinkTime());
}
