# Changelog

บันทึกการเปลี่ยนแปลงที่ผู้ใช้เห็นได้ รูปแบบตาม [Keep a Changelog](https://keepachangelog.com/)

## [Unreleased]

### Added
- **ปรับพารามิเตอร์ต่อการรันได้จากหน้าควบคุม** — แต่ละชุดทดสอบมีช่องกรอกของตัวเอง
  (VUs, ระยะเวลา, อัตรา req/s, ขนาด body ฯลฯ) หน้าเว็บสร้างช่องจาก `/api/config` อัตโนมัติ
  เว้นว่าง = ใช้ค่าเริ่มต้นใน `config/config.js`; ไฟล์ test อ่าน override ผ่าน `envInt`/`envStr`
- helper `envInt()`/`envStr()` ใน `config/config.js` สำหรับอ่านค่า override จาก env
- หน้าควบคุม: ย้ายคอนโซล "ผลการรันแบบสด" ลงมาเป็นแถวเต็มความกว้าง (เดิมวางข้างฟอร์ม)

### Security
- `server.py` และ `server.js` กันเว็บอื่นสั่งรัน k6 ผ่านเบราว์เซอร์ของผู้ใช้ (CSRF / DNS rebinding):
  ตรวจ `Host` ทุกคำขอ, ปฏิเสธ `Origin` ที่ไม่ใช่หน้าเว็บนี้ (403) และ `/api/run`
  ต้องส่งเป็น `application/json` (415) — เปิดผ่าน `127.0.0.1` หรือ `localhost` ที่พอร์ตเดิมได้ตามปกติ
- แดชบอร์ด escape ชื่อชุดทดสอบ/ข้อความ verdict ก่อนแสดง (ข้อมูลจาก DB)
- `AUTH_TOKEN` ถูกปิดบังเป็น `***` ในบรรทัด "คำสั่ง:" ของ log สด (เดิมโชว์ค่าจริง)
- พารามิเตอร์จากหน้าเว็บถูกตรวจชนิด/ช่วง + รับเฉพาะ key ที่กำหนดต่อชุด ก่อนส่งเป็น `-e` ให้ k6

### Fixed
- รัน `k6 run tests/<ชุด>.js` ตรงๆ โดยไม่ส่ง `-e TEST_TYPE` ถูกบันทึกเป็นชนิด `run`
  — ตอนนี้อ่าน `tags.test_type` ของไฟล์ test ได้ถูกต้อง
- Security scan ฟ้องผิด: ตัด signature `49` และ `uid=` ที่ชนข้อมูลปกติ
  (id, timestamp, query string) ใช้รูปแบบผลคำสั่ง `id` จริงแทน

### Added — ชุดทดสอบ
- ชุดทดสอบใหม่ **Throughput** (`tests/throughput.js`) — ไต่อัตรา req/s เป็นขั้นด้วย
  ramping-arrival-rate เพื่อหาเพดาน req/s และจุดที่เจอ rate limit (429);
  นับ 429 เป็นพฤติกรรมที่ดี ไม่ใช่ error
- ชุดทดสอบใหม่ **Breakpoint** (`tests/breakpoint.js`) — ไต่โหลดขึ้นจนระบบเริ่มพังจริง
  แล้วหยุดอัตโนมัติ (abortOnFail) เพื่อหาเพดานจริง (กี่ VUs/req/s); ไม่นับ 429 เป็นการพัง
- ชุดทดสอบใหม่ **Defense** (`tests/defense.js`) — ยิงหนักคงที่เพื่อตรวจว่าเกราะกันโหลด
  (rate limit 429/503) ทำงานจริงไหมโดยระบบไม่ล่ม — แนวทางเตรียมพร้อมรับ DDoS บนระบบของตัวเอง
- ชุดทดสอบใหม่ **Payload** (`tests/payload.js`) — ส่ง body ใหญ่ขึ้น (1KB→10MB)
  ดูว่าระบบตอบ 413 อย่างถูกต้องไหม หรือ 5xx/ล่ม; รายงานจำนวน body ที่ถูกปฏิเสธ (413)
- แดชบอร์ดแสดง**ประวัติการรันทั้งหมดจาก SQLite**: กราฟแนวโน้ม p95/p99 ตามเวลา
  ตารางทุกการรัน (เป้าหมาย, สถานะ, metric) และตัวกรองตามชุดทดสอบ
- `/api/history` ส่ง `label`, `color`, `verdict` ของแต่ละการรัน
- metric ใหม่ `rateLimited` (429) และ `oversizeRejected` (413) ในผลสรุป
- เอกสาร: `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/API.md`, `docs/DATABASE.md`

### Fixed
- URL เป้าหมายในหัวแดชบอร์ดถูก escape ก่อนแสดง

## 2026-11-24

### Added
- เก็บผลทดสอบถาวรใน SQLite (`reports/results.db`): แดชบอร์ด ประวัติ และรายงาน static อ่านจาก DB
  ผลแต่ละไฟล์มี `rx_meta` (ชนิดชุด, เป้าหมาย, เวลา) (`a4b8b93`)
- ส่งออก p(99) ใน summary ของ k6 ให้รายงานแสดง p99 ได้ (`d532ec3`)
- เวอร์ชัน Python ของ web server และตัวสร้างรายงาน (stdlib ล้วน) เป็นค่าเริ่มต้น เก็บเวอร์ชัน Node ไว้ (`b76e7c1`)
- Web app: หน้าควบคุมการทดสอบพร้อม log สด และหน้าแดชบอร์ดรายงาน (`85aa9b0`)
- เฟรมเวิร์กทดสอบด้วย k6: smoke, load, stress, spike, soak, security (OWASP), fuzz
  พร้อมรายงาน HTML สำหรับผู้บริหาร (`44c892a`)

### Changed
- ปรับ UI หลังรีวิว UX: รองรับมือถือ, ฟอนต์ไทย, แดชบอร์ดอ่านง่ายขึ้น (`4c51ba4`)
- ออกแบบ web app ใหม่เป็นธีม dark สำหรับนักพัฒนา (`caf0096`)
- ปรับ accessibility ของหน้าเว็บ (focus, contrast, reduced motion) (`3c02259`)
- ไม่ track ไฟล์ `__pycache__` (`ef41579`)
