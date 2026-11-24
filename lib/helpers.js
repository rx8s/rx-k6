// ============================================================================
// helpers.js — ฟังก์ชันร่วมที่ใช้ซ้ำในทุกชุดทดสอบ
// ============================================================================
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS } from '../config/config.js';

// metric ที่กำหนดเอง เพื่อแยกวัดเป็นด้านๆ ในรายงาน
export const bizErrors = new Counter('business_errors');      // error เชิงธุรกิจ (4xx/5xx ที่ไม่คาดหวัง)
export const securityHits = new Counter('security_findings'); // ช่องโหว่/จุดน่าสงสัยที่เจอ
export const rateLimited = new Counter('rate_limited');       // โดนจำกัดอัตรา 429/503 (throughput, defense)
export const endpointLatency = new Trend('endpoint_latency', true);
export const checksPassed = new Rate('checks_passed');

// สร้าง URL เต็มจาก path
export function url(path) {
  return `${BASE_URL}${path}`;
}

// ยิง request ตาม spec ของ endpoint แล้ววัดผล
export function callEndpoint(ep, name) {
  const target = url(ep.path);
  const params = { headers: DEFAULT_HEADERS, tags: { endpoint: name || ep.path } };
  let res;

  if (ep.method === 'GET') {
    res = http.get(target, params);
  } else if (ep.method === 'POST') {
    res = http.post(target, JSON.stringify(ep.body || {}), params);
  } else if (ep.method === 'PUT') {
    res = http.put(target, JSON.stringify(ep.body || {}), params);
  } else if (ep.method === 'DELETE') {
    res = http.del(target, null, params);
  } else {
    res = http.request(ep.method, target, JSON.stringify(ep.body || {}), params);
  }

  endpointLatency.add(res.timings.duration, { endpoint: name || ep.path });

  const ok = check(res, {
    [`${name}: status < 400`]: (r) => r.status > 0 && r.status < 400,
    [`${name}: มี response body`]: (r) => r.body && r.body.length >= 0,
  });
  checksPassed.add(ok);
  if (!ok) bizErrors.add(1, { endpoint: name || ep.path });

  return res;
}

// สุ่มหน่วงเวลาเลียนแบบผู้ใช้จริง (think time)
export function thinkTime() {
  return Math.random() * 2 + 0.5; // 0.5–2.5 วินาที
}

// สรุปแบบย่อสำหรับ log ระหว่างรัน
export function logResult(tag, res) {
  if (res.status >= 400 || res.status === 0) {
    console.warn(`[${tag}] status=${res.status} dur=${res.timings.duration.toFixed(0)}ms`);
  }
}
