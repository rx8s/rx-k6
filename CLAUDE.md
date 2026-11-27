# CLAUDE.md — คู่มือโปรเจกต์สำหรับ Claude Code / ผู้พัฒนา

rx_k6 คือเฟรมเวิร์กทดสอบสมรรถนะและความปลอดภัยเบื้องต้นด้วย k6 พร้อม web app (สั่งรัน + แดชบอร์ด)
และรายงานผู้บริหาร ผลทุกครั้งเก็บถาวรใน SQLite

> ⚠️ ยิงทดสอบได้เฉพาะเป้าหมายที่ผู้ใช้ยืนยันว่าเป็นเจ้าของหรือได้รับอนุญาต ห้ามรัน k6 ใส่ URL ภายนอก
> ที่ผู้ใช้ไม่ได้ระบุเอง ค่าเริ่มต้นคือ `http://localhost:8080` (ดู [SECURITY.md](SECURITY.md))

## คำสั่งที่ใช้บ่อย

```bash
python3 server.py                     # web app → http://127.0.0.1:4000 (หรือ ./run.sh)
python3 scripts/test_report_core.py   # self-test ของ report_core (SQLite) — รันทุกครั้งที่แก้ไฟล์นี้
python3 scripts/test_server.py        # เทสต์ server.py (Host/Origin, allowlist, พารามิเตอร์) — รันทุกครั้งที่แก้ server.py
python3 scripts/test_make_report.py   # เทสต์รายงานผู้บริหาร — รันทุกครั้งที่แก้ make_report.py
python3 scripts/report_core.py        # นำเข้า reports/*.json → reports/results.db เอง
python3 scripts/make_report.py        # สร้าง reports/executive-report.html
k6 run -e BASE_URL=http://localhost:8080 tests/smoke.js
node --check web/dashboard.js         # เช็ก syntax JS ฝั่งเว็บ (ไม่มี build step)
```

ไม่มี dependency ให้ติดตั้ง: Python ใช้ stdlib ล้วน, Node ใช้ built-in, ต้องมีแค่ `k6`

## สถาปัตยกรรม

```
web UI (web/*.html, *.js) ──HTTP/SSE──▶ server.py ──subprocess──▶ k6 run tests/<type>.js
                                           │                          │
                                           │                          ▼ lib/summary.js
                                           │                   reports/<type>-<ts>.json
                                           ▼                          │
                         scripts/report_core.py  ◀── ingest() ────────┘
                                           │
                                  reports/results.db (ตาราง runs)
                                           │
                  aggregate() → /api/dashboard     history() → /api/history
```

- ฝั่ง server/รายงานเป็น Python ล้วน (`server.py`, `scripts/report_core.py`, `scripts/make_report.py`)
  ไฟล์ JavaScript มีแค่หน้าเว็บ (`web/`) และชุดทดสอบ k6 (`tests/`, `lib/`, `config/`)
- รายละเอียด API: [docs/API.md](docs/API.md) · ฐานข้อมูล: [docs/DATABASE.md](docs/DATABASE.md)

## ข้อตกลงในโค้ด

- คอมเมนต์ ข้อความ UI และ commit body เขียนเป็น**ภาษาไทย** (ชื่อตัวแปร/ฟังก์ชันเป็นอังกฤษ)
- `server.py` ผูกกับ `127.0.0.1` เท่านั้น และ `/api/run` ต้องมี `authorized: true` — ห้ามผ่อนปรน
- ชุดทดสอบที่สั่งผ่าน UI ต้องอยู่ใน allowlist `TESTS` ของ `server.py` (กัน command injection)
  ค่า `note` (เวลาโดยประมาณ) ต้องตรงกับ `PROFILES` ใน `config/config.js`
- ทุกไฟล์ `tests/*.js` ต้องมี `tags: { test_type }`, `summaryTrendStats: SUMMARY_TREND_STATS`
  และ `export { handleSummary } from '../lib/summary.js'` — ไม่งั้นผลจะไม่ถูกบันทึกลง DB/รายงาน
- ข้อความ/ข้อมูลที่มาจาก DB หรือผู้ใช้ ต้อง escape ก่อนใส่ `innerHTML` (ใช้ `esc()` ใน dashboard.js)
- UI ธีม dark ตาม `design-system/rx_k6/MASTER.md`; สีใช้ CSS variable ใน `web/styles.css`
  Chart.js 4.4.1 โหลดจาก cdnjs
- เพิ่มชุดทดสอบใหม่: ต้องแก้หลายจุด ดูเช็กลิสต์ใน [CONTRIBUTING.md](CONTRIBUTING.md)
- บันทึกการเปลี่ยนแปลงที่ผู้ใช้เห็นได้ลง [CHANGELOG.md](CHANGELOG.md)

## ไฟล์ที่ไม่ควร commit

`reports/*.json`, `reports/*.html`, `reports/*.db`, `__pycache__/`, `.claude/settings.local.json` (อยู่ใน `.gitignore` แล้ว)
