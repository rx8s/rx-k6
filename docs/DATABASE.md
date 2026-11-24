# ฐานข้อมูลผลทดสอบ (`reports/results.db`)

ผลทุกการรันเก็บถาวรใน SQLite ไฟล์เดียว ลบไฟล์ JSON ใน `reports/` ทิ้งแล้วข้อมูลยังอยู่
ไฟล์ DB ไม่ถูก commit (อยู่ใน `.gitignore`) — สำรองเองถ้าต้องการเก็บประวัติ

## ข้อมูลเข้า DB อย่างไร

1. k6 จบการรัน → `lib/summary.js` เขียน `reports/<type>-<timestamp>.json`
   พร้อม `rx_meta` (`testType`, `baseUrl`, `ranAt`)
2. `ingest()` ใน `scripts/report_core.py` นำไฟล์ที่ยังไม่เคยนำเข้าเข้าตาราง `runs`
   (กันซ้ำด้วยชื่อไฟล์, ข้าม `latest.json` และ `executive-report.json`, ไฟล์เสียจะลองใหม่รอบหน้า)
3. `ingest()` ถูกเรียกอัตโนมัติเมื่อ:
   - รันจบผ่าน web app (log จะแสดง `💾 บันทึกผลลง reports/results.db แล้ว`)
   - เปิด/รีเฟรชแดชบอร์ด (`/api/dashboard`, `/api/history`)
   - `scripts/run-all.sh` และ `scripts/make_report.py`
4. รัน `k6 run` เองจาก CLI แล้วอยากเห็นผลทันที: `python3 scripts/report_core.py`

ไฟล์ JSON ที่ไม่มี `rx_meta` (ผลรุ่นเก่า) ยังนำเข้าได้: ใช้ชื่อไฟล์เดา `test_type`
และเวลาแก้ไขไฟล์เป็น `ran_at`, `base_url` จะเป็น `NULL`

## Schema

```sql
CREATE TABLE runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file              TEXT    NOT NULL UNIQUE,   -- ไฟล์ k6 ต้นทาง (กันนำเข้าซ้ำ)
  test_type         TEXT    NOT NULL,          -- smoke/load/stress/spike/soak/security/fuzz
  base_url          TEXT,                      -- เป้าหมายที่ยิง
  ran_at            TEXT    NOT NULL,          -- ISO-8601 UTC เช่น 2026-11-24T05:00:00+00:00
  total_reqs        INTEGER,
  rps               REAL,
  avg_ms            REAL,
  p95_ms            REAL,
  p99_ms            REAL,
  max_ms            REAL,
  fail_rate         REAL,                      -- %
  max_vus           INTEGER,
  check_rate        REAL,                      -- %
  security_findings INTEGER,
  biz_errors        INTEGER,
  thresholds_ok     INTEGER,                   -- 1 = ผ่านทุก threshold
  summary_json      TEXT    NOT NULL           -- summary ดิบของ k6 ทั้งก้อน
);
CREATE INDEX idx_runs_type_time ON runs (test_type, ran_at);
```

คอลัมน์ตัวเลขมีไว้ query ด้วย SQL ได้สะดวก ส่วนแอปคำนวณ metric ใหม่จาก `summary_json` ทุกครั้ง
(ถ้าแก้ `metrics()` ผลเก่าก็ได้ค่าตามตรรกะใหม่ แต่คอลัมน์ตัวเลขยังเป็นค่าตอนนำเข้า)
Schema สร้างอัตโนมัติด้วย `CREATE TABLE IF NOT EXISTS` — ถ้าเพิ่มคอลัมน์ต้องเขียน `ALTER TABLE` เอง

## ตัวอย่าง query

```bash
DB=reports/results.db

# แนวโน้ม p95 ของชุด load
sqlite3 $DB "SELECT ran_at, p95_ms, fail_rate FROM runs WHERE test_type='load' ORDER BY ran_at"

# ผลล่าสุดของแต่ละชุด
sqlite3 -header -column $DB "
  SELECT test_type, MAX(ran_at) AS ran_at, p95_ms, fail_rate
  FROM runs GROUP BY test_type"

# การรันที่ threshold ไม่ผ่านใน 7 วันที่ผ่านมา
sqlite3 $DB "SELECT ran_at, test_type, base_url FROM runs
             WHERE thresholds_ok = 0 AND datetime(ran_at) >= datetime('now', '-7 days')"

# ส่งออกเป็น CSV
sqlite3 -header -csv $DB "SELECT id, test_type, base_url, ran_at, p95_ms, p99_ms, fail_rate FROM runs" > runs.csv

# ดึง metric อื่นจาก summary ดิบ (เช่น p90)
sqlite3 $DB "SELECT ran_at, json_extract(summary_json, '$.metrics.http_req_duration.values.\"p(90)\"')
             FROM runs WHERE test_type='load'"
```

## ดูแลรักษา

```bash
# สำรอง (ปลอดภัยแม้ server กำลังเขียน)
sqlite3 reports/results.db ".backup reports/results-backup.db"

# ลบประวัติเก่ากว่า 90 วัน แล้วคืนพื้นที่ (ลบถาวร — สำรองก่อน)
sqlite3 reports/results.db "DELETE FROM runs WHERE datetime(ran_at) < datetime('now', '-90 days'); VACUUM;"
```

> ถ้าลบแถวออกจาก DB แต่ไฟล์ JSON ต้นทางยังอยู่ใน `reports/` ครั้งถัดไปที่ `ingest()` ทำงาน
> แถวนั้นจะถูกนำเข้ากลับมาอีก — ลบ/ย้ายไฟล์ JSON นั้นด้วย
