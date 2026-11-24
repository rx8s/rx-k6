# rx_k6 — เฟรมเวิร์กจำลองการโจมตี/ทดสอบระบบ

ชุดทดสอบ **สมรรถนะ + ความทนทาน + ความปลอดภัยเบื้องต้น** สำหรับระบบที่คุณพัฒนาเอง
สร้างด้วย [k6](https://k6.io) พร้อมตัวสร้าง **รายงาน HTML สำหรับผู้บริหาร** อัตโนมัติ

> ⚠️ **ใช้กับระบบที่คุณเป็นเจ้าของหรือได้รับอนุญาตเป็นลายลักษณ์อักษรเท่านั้น**
> การยิงโหลด/ส่ง payload ใส่ระบบของผู้อื่นโดยไม่ได้รับอนุญาตผิดกฎหมาย

---

## ครอบคลุม 4 ด้าน

| ชุด | ไฟล์ | ตอบคำถามผู้บริหาร |
|-----|------|-------------------|
| **Smoke** | `tests/smoke.js` | ระบบตอบได้ไหม (เช็กก่อนรันจริง) |
| **Load** | `tests/load.js` | รับโหลดปกติตามที่คาดหวังได้ไหม |
| **Stress** | `tests/stress.js` | รับได้กี่ผู้ใช้พร้อมกันก่อนเริ่มช้า/ล่ม |
| **Spike** | `tests/spike.js` | รอด+ฟื้นตัวจาก traffic พุ่งกะทันหันไหม |
| **Soak** | `tests/soak.js` | รันยาวๆ โดยไม่มี memory leak ไหม |
| **Security** | `tests/security.js` | กรอง SQLi / XSS / Path Traversal / Cmd / NoSQL ได้ไหม |
| **Fuzz** | `tests/fuzz.js` | รับมือ input ผิดรูปแบบได้โดยไม่ crash ไหม |

---

## 🌐 Web App (แนะนำ)

เปิดหน้าเว็บสำหรับตั้งค่า + สั่งรันทดสอบ (ดูผลสด) และแดชบอร์ดรายงานแยกหน้า:

```bash
npm run web
```
แล้วเปิด **http://127.0.0.1:4000**
- หน้า **ควบคุม** (`/`) — ตั้ง BASE_URL, เลือกชุดทดสอบ, ติ๊กยืนยันสิทธิ์, กดรัน แล้วดู log สดๆ
- หน้า **แดชบอร์ด** (`/dashboard`) — KPI รวม, การ์ดรายด้าน (เขียว/เหลือง/แดง), กราฟ latency & error, ตารางละเอียด, ปุ่มพิมพ์เป็น PDF

> เซิร์ฟเวอร์ผูกกับ `127.0.0.1` เท่านั้น (เครื่องตัวเอง) และ UI บังคับติ๊กยืนยันสิทธิ์ก่อนรันทุกครั้ง
> เปลี่ยนพอร์ตได้: `PORT=5000 npm run web`

---

## เริ่มใช้งาน (CLI)

### 1) ตั้งเป้าหมาย
แก้ `config/config.js` → `ENDPOINTS` ให้ตรงกับ API ของระบบคุณ
และแก้ `scenarios/endpoints.json` (ช่อง `injectable`) สำหรับชุด Security/Fuzz

### 2) รันทีละชุด
```bash
BASE_URL=https://staging.example.com npm run smoke
BASE_URL=https://staging.example.com npm run load
BASE_URL=https://staging.example.com npm run security
```

### 3) รันครบทุกชุด + ออกรายงาน
```bash
BASE_URL=https://staging.example.com npm run all
```
(ข้ามชุด soak ที่ใช้เวลานาน: `SKIP_SOAK=1 BASE_URL=... npm run all`)

### 4) สร้างรายงานผู้บริหารจากผลล่าสุด
```bash
npm run report
open reports/executive-report.html
```

---

## ปรับความเข้ม
แก้ `PROFILES` และ `THRESHOLDS` ใน `config/config.js`
- `THRESHOLDS` = เกณฑ์ SLA (ใช้ตัดสิน "ผ่าน/ไม่ผ่าน" ในรายงาน) — เริ่มต้น: error < 1%, p95 < 800ms
- `PROFILES` = จำนวน VUs และระยะเวลาแต่ละชุด — เริ่มต้นไว้แบบอนุรักษ์นิยม ค่อยเพิ่มตามจริง

## ถ้าต้องล็อกอิน
```bash
BASE_URL=... AUTH_TOKEN=<token> npm run load
```

---

## โครงสร้าง
```
server.js               web app (API + ตัวรัน k6 + สตรีมผลสด) — ไม่มี dependency
web/                    หน้าเว็บ: index.html (ควบคุม), dashboard.html, *.js, styles.css
config/config.js        ค่ากลาง: BASE_URL, thresholds, profiles, endpoints
lib/helpers.js          ฟังก์ชันร่วม + metric ที่กำหนดเอง
lib/payloads.js         payload ความปลอดภัย + ค่าสำหรับ fuzz
lib/summary.js          บันทึกผลลง reports/ (ใช้ร่วมทุก test)
scenarios/endpoints.json นิยาม endpoint + field ที่จะทดสอบ inject
tests/*.js              ชุดทดสอบทั้ง 7
scripts/report-core.js  logic อ่าน/สรุปผล (ใช้ร่วม make-report + server)
scripts/run-all.sh      รันครบทุกชุด (มีขั้นยืนยันสิทธิ์)
scripts/make-report.js  รวมผล → reports/executive-report.html (static)
reports/                ผลลัพธ์ (JSON + HTML)
```

## หมายเหตุด้านความปลอดภัย
ชุด `security.js` ใช้ payload ตรวจจับมาตรฐาน (OWASP) รันด้วย 1 VU แบบสุภาพ
เพื่อดูว่าระบบ **กรอง/ป้องกัน** ได้หรือไม่ — เป็นการตรวจเบื้องต้น
ไม่ทดแทนการตรวจประเมินความปลอดภัยเชิงลึก (penetration test) โดยผู้เชี่ยวชาญ
