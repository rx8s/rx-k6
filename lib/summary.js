// ============================================================================
// summary.js — handleSummary ที่ใช้ร่วมกันทุก test
//   เขียนผลเป็น JSON ลง reports/ เพื่อให้ scripts/make-report.js เอาไปรวมเป็น
//   รายงานผู้บริหาร และพิมพ์สรุปย่อลง stdout
//
//   วิธีใช้ในไฟล์ test:  export { handleSummary } from '../lib/summary.js';
// ============================================================================
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

export function handleSummary(data) {
  const testType =
    (data.options && data.options.tags && data.options.tags.test_type) ||
    __ENV.TEST_TYPE ||
    'run';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `reports/${testType}-${stamp}.json`;

  // เก็บข้อมูลดิบไว้ให้ตัวสร้างรายงานใช้ + โชว์สรุป text บนจอ
  const out = {};
  out[file] = JSON.stringify(data, null, 2);
  out['reports/latest.json'] = JSON.stringify(
    { testType, generatedAt: new Date().toISOString(), baseUrl: __ENV.BASE_URL || 'http://localhost:8080', data },
    null, 2,
  );
  out['stdout'] = '\n' + textSummary(data, { indent: ' ', enableColors: true }) + '\n';
  return out;
}
