// ============================================================================
// summary.js — handleSummary ที่ใช้ร่วมกันทุก test
//   เขียนผลเป็น JSON ลง reports/ เพื่อให้ scripts/make-report.js เอาไปรวมเป็น
//   รายงานผู้บริหาร และพิมพ์สรุปย่อลง stdout
//
//   วิธีใช้ในไฟล์ test:  export { handleSummary } from '../lib/summary.js';
// ============================================================================
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

export function handleSummary(data) {
  // data.options ของ handleSummary ไม่มี tags (k6 ส่งมาแค่ summaryTrendStats ฯลฯ)
  //   จึงอ่าน tags.test_type จาก exec.test.options แทน — รัน k6 ตรงๆ โดยไม่ส่ง TEST_TYPE ก็ได้ชนิดถูก
  const tags = (exec.test.options && exec.test.options.tags) || {};
  const testType = tags.test_type || __ENV.TEST_TYPE || 'run';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `reports/${testType}-${stamp}.json`;

  // เก็บข้อมูลดิบไว้ให้ตัวสร้างรายงานใช้ + โชว์สรุป text บนจอ
  // rx_meta: ข้อมูลประกอบที่ k6 summary ไม่มี — report_core.py ใช้ตอนนำเข้า SQLite
  const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
  const meta = { testType, baseUrl, ranAt: new Date().toISOString() };
  const out = {};
  out[file] = JSON.stringify({ ...data, rx_meta: meta }, null, 2);
  out['reports/latest.json'] = JSON.stringify(
    { testType, generatedAt: meta.ranAt, baseUrl, data },
    null, 2,
  );
  out['stdout'] = '\n' + textSummary(data, { indent: ' ', enableColors: true }) + '\n';
  return out;
}
