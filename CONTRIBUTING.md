# การพัฒนาต่อ (Contributing)

## เตรียมเครื่อง

- [k6](https://k6.io) (`brew install k6`)
- Python 3.9+ (ใช้ stdlib ล้วน ไม่ต้อง `pip install`)
- Node 22+ — ใช้แค่ `node --check` เช็ก syntax ไฟล์ JS (รุ่นเก่ากว่านี้เช็กไฟล์ test ไม่ผ่าน; CI ใช้ Node 22)
- เป้าหมายสำหรับทดสอบในเครื่อง: API ของคุณเองที่ `http://localhost:8080` (ค่าเริ่มต้น)

## ก่อน commit

```bash
python3 scripts/test_report_core.py                    # ต้องขึ้น "OK — report_core SQLite tests passed"
python3 scripts/test_server.py                         # ต้องขึ้น "OK — server tests passed" (ไม่รัน k6 จริง)
python3 scripts/test_make_report.py                    # ต้องขึ้น "OK — make_report tests passed"
node --check web/app.js && node --check web/dashboard.js
python3 server.py                                      # เปิด /dashboard ดูว่าไม่มี error ใน console
```

ทุก PR จะรัน CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) อัตโนมัติ: `py_compile`,
`test_report_core.py`, `test_server.py`, `test_make_report.py`, `node --check` ทุกไฟล์ JS และ `k6 inspect` ทุกชุดทดสอบ
(ไม่ยิง request ใส่เป้าหมายใดๆ)

- คอมเมนต์และข้อความ UI เป็นภาษาไทย ชื่อตัวแปรเป็นอังกฤษ
- commit message: หัวข้อภาษาอังกฤษสั้นๆ แบบ imperative, เนื้อหาอธิบายเป็นภาษาไทยได้
- บันทึกการเปลี่ยนแปลงที่ผู้ใช้เห็นลง [CHANGELOG.md](CHANGELOG.md) หัวข้อ `[Unreleased]`
- ห้าม commit `reports/*.json|html|db` และ token/รหัสผ่านใดๆ

## เพิ่มชุดทดสอบใหม่ (เช่น `breakpoint`)

ชื่อชุดทดสอบ (`test_type`) ถูกอ้างอิงหลายที่ แก้ให้ครบทุกจุด:

| ไฟล์ | สิ่งที่ต้องทำ |
|------|---------------|
| `tests/breakpoint.js` | `options` ต้องมี `tags: { test_type: 'breakpoint' }` และ `summaryTrendStats: SUMMARY_TREND_STATS`; `export { handleSummary } from '../lib/summary.js'`; ถ้าอยากให้ปรับค่าได้จากหน้าเว็บ ให้อ่านผ่าน `envInt`/`envStr` โดยมี `PROFILES` เป็น default |
| `config/config.js` | เพิ่มค่าใน `PROFILES` (ถ้ามีโหลด) |
| `server.py` | เพิ่มใน allowlist `TESTS` พร้อม `label` และ `note` (เวลาให้ตรงกับ PROFILES); เพิ่มพารามิเตอร์ที่ปรับได้ใน `TEST_OPTIONS` (key = env ที่ test อ่าน, default ให้ตรงกับ PROFILES) — หน้าเว็บจะสร้างช่องกรอกให้เอง |
| `scripts/report_core.py` | เพิ่มใน `TYPE_LABEL` และ `ORDER`; ถ้าตัดสินผลต่างจากชุดโหลดทั่วไป แก้ `verdict()` |
| `web/app.js` | เพิ่มไอคอนใน `ICONS` |
| `web/dashboard.js` | เพิ่มใน `ORDER`; ถ้าเป็นชุดโหลด เพิ่มสีใน `TYPE_COLOR`; ถ้าเป็นชุดสแกน (ไม่มี latency ที่มีความหมาย) เพิ่มใน `isScan()` |
| `package.json` | เพิ่ม script `"breakpoint": "k6 run -e TEST_TYPE=breakpoint tests/breakpoint.js"` |
| `scripts/run-all.sh` | เพิ่ม `run breakpoint` ตามลำดับที่เหมาะสม |
| `README.md` | เพิ่มแถวในตาราง "ครอบคลุม" |
| `scripts/test_report_core.py` | ถ้าแก้ `verdict()` ให้เพิ่ม assert |

## เพิ่ม metric ใหม่ลงแดชบอร์ด

1. สร้าง metric ใน `lib/helpers.js` (`Counter`/`Trend`/`Rate` ของ k6) แล้วใช้ในชุดทดสอบ
2. อ่านค่าใน `metrics()` ของ `scripts/report_core.py`
3. ถ้าต้องการ query ด้วย SQL ให้เพิ่มคอลัมน์ใน `SCHEMA` + `INSERT` ใน `ingest()`
   และเขียน `ALTER TABLE` สำหรับ DB ที่มีอยู่แล้ว (ดู [docs/DATABASE.md](docs/DATABASE.md))
4. แสดงผลใน `web/dashboard.js` และ `scripts/make_report.py`

## แก้ API / หน้าเว็บ

- อัปเดต [docs/API.md](docs/API.md) เมื่อเปลี่ยนรูปแบบ request/response
- ค่าที่มาจาก DB/ผู้ใช้ต้องผ่าน `esc()` ก่อนใส่ `innerHTML`
- ดีไซน์ตาม `design-system/rx_k6/MASTER.md` และ CSS variable ใน `web/styles.css`
