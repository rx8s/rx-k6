// ============================================================================
// stress.js — เพิ่มโหลดขึ้นเรื่อยๆ เพื่อหา "จุดพัง" (breaking point)
//   ใช้ตอบผู้บริหารว่า "ระบบรับได้กี่ผู้ใช้พร้อมกันก่อนเริ่มช้า/ล่ม"
// ============================================================================
import { sleep } from 'k6';
import { PROFILES, ENDPOINTS } from '../config/config.js';
import { callEndpoint } from '../lib/helpers.js';

export { handleSummary } from '../lib/summary.js';

const { maxVus, rampMinutes } = PROFILES.stress;

export const options = {
  // ค่อยๆ ไต่ขึ้นเป็นขั้น เพื่อดูว่าเริ่มเสื่อมที่โหลดเท่าไร
  stages: [
    { duration: `${rampMinutes / 2}m`, target: Math.round(maxVus / 2) },
    { duration: `${rampMinutes / 2}m`, target: maxVus },
    { duration: '2m', target: 0 }, // ค่อยๆ ลดลง ดูว่าระบบฟื้นตัวได้ไหม
  ],
  // ไม่ใส่ threshold แบบ abort เพราะต้องการ "ดูจนพัง" ไม่ใช่หยุดก่อน
  thresholds: {
    http_req_duration: ['p(95)<3000'], // ใช้เป็นสัญญาณเตือน ไม่ abort
  },
  tags: { test_type: 'stress' },
};

export default function () {
  callEndpoint(ENDPOINTS.list, 'list');
  callEndpoint(ENDPOINTS.detail, 'detail');
  sleep(1);
}
