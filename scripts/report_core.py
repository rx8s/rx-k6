#!/usr/bin/env python3
# ============================================================================
# report_core.py — logic อ่าน/สรุปผล k6 ที่ใช้ร่วมกัน (make_report.py + server.py)
#   ผลทุกครั้งเก็บถาวรใน SQLite: reports/results.db (ตาราง runs)
#   k6 เขียน reports/*.json → ingest() นำเข้า DB (รันซ้ำได้ ไม่ซ้ำ) → แดชบอร์ดอ่านจาก DB
#
#   นำเข้าเอง:  python3 scripts/report_core.py
# ============================================================================
import json
import os
import re
import sqlite3
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(ROOT, "reports")
DB_PATH = os.path.join(REPORTS_DIR, "results.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file              TEXT    NOT NULL UNIQUE,   -- ไฟล์ k6 ต้นทาง (กันนำเข้าซ้ำ)
  test_type         TEXT    NOT NULL,
  base_url          TEXT,
  ran_at            TEXT    NOT NULL,          -- ISO-8601 UTC
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
CREATE INDEX IF NOT EXISTS idx_runs_type_time ON runs (test_type, ran_at);
"""

TYPE_LABEL = {
    "smoke": "Smoke (เช็กเบื้องต้น)",
    "load": "Load (โหลดปกติ)",
    "stress": "Stress (หาจุดพัง)",
    "spike": "Spike (traffic พุ่ง)",
    "soak": "Soak (รันยาว)",
    "throughput": "Throughput (เพดาน req/s)",
    "breakpoint": "Breakpoint (จุดพังจริง)",
    "security": "Security (OWASP)",
    "fuzz": "API Fuzzing",
    "payload": "Payload (body ใหญ่)",
    "defense": "Defense (เกราะกันโหลด)",
}

ORDER = ["smoke", "load", "stress", "spike", "throughput", "breakpoint",
         "soak", "security", "fuzz", "payload", "defense"]

_DATE_RE = re.compile(r"-\d{4}-\d{2}-\d{2}")


def _num(v, d=2):
    """ปัดทศนิยม คืน None ถ้าไม่ใช่ตัวเลขที่ใช้ได้"""
    try:
        if v is None:
            return None
        f = float(v)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        r = round(f, d)
        return int(r) if r == int(r) and d == 0 else r
    except (TypeError, ValueError):
        return None


def _connect(db_path=None):
    con = sqlite3.connect(db_path or DB_PATH, timeout=10)  # timeout: server หลาย thread เขียนพร้อมกันได้
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def _iso_utc(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc).isoformat(timespec="seconds")


def ingest(reports_dir=None, db_path=None):
    """นำไฟล์ผล k6 (reports/*.json) เข้า SQLite — ไฟล์ที่นำเข้าแล้วจะถูกข้าม คืนจำนวนแถวที่เพิ่ม"""
    reports_dir = reports_dir or REPORTS_DIR
    if not os.path.isdir(reports_dir):
        return 0
    added = 0
    con = _connect(db_path)
    try:
        known = {r[0] for r in con.execute("SELECT file FROM runs")}
        for f in sorted(os.listdir(reports_dir)):
            if (not f.endswith(".json") or f in known
                    or f in ("latest.json", "executive-report.json")):
                continue
            full = os.path.join(reports_dir, f)
            try:
                with open(full, encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, json.JSONDecodeError):
                continue  # ไฟล์ยังเขียนไม่เสร็จ/เสีย — ลองใหม่รอบหน้า
            meta = data.get("rx_meta") or {}
            ran_at = (_iso_utc(meta["ranAt"]) if meta.get("ranAt") else
                      datetime.fromtimestamp(os.path.getmtime(full), timezone.utc).isoformat(timespec="seconds"))
            mx = metrics(data)
            cur = con.execute(
                """INSERT OR IGNORE INTO runs (file, test_type, base_url, ran_at, total_reqs, rps, avg_ms,
                   p95_ms, p99_ms, max_ms, fail_rate, max_vus, check_rate, security_findings, biz_errors,
                   thresholds_ok, summary_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (f, meta.get("testType") or _DATE_RE.split(f)[0], meta.get("baseUrl"), ran_at,
                 mx["totalReqs"], mx["rps"], mx["avg"], mx["p95"], mx["p99"], mx["max"], mx["failRate"],
                 mx["maxVus"], mx["checkRate"], mx["securityFindings"], mx["bizErrors"], int(mx["thrOk"]),
                 json.dumps(data, ensure_ascii=False)))
            added += cur.rowcount
        con.commit()
    finally:
        con.close()
    return added


def history(limit=200, reports_dir=None, db_path=None):
    """ประวัติการรันทั้งหมด ใหม่สุดก่อน"""
    ingest(reports_dir, db_path)
    con = _connect(db_path)
    try:
        rows = con.execute("SELECT file, test_type, base_url, ran_at, summary_json FROM runs "
                           "ORDER BY ran_at DESC, id DESC LIMIT ?", (limit,)).fetchall()
    finally:
        con.close()
    items = []
    for r in rows:
        mx = metrics(json.loads(r["summary_json"]))
        color, msg = verdict(r["test_type"], mx)
        items.append({"file": r["file"], "type": r["test_type"], "label": TYPE_LABEL.get(r["test_type"], r["test_type"]),
                      "baseUrl": r["base_url"], "ranAt": r["ran_at"], "color": color, "verdict": msg,
                      "metrics": mx})
    return items


def metrics(data):
    """ดึง metric สำคัญจาก summary ดิบของ k6"""
    m = (data or {}).get("metrics", {}) or {}

    def vals(name):
        return (m.get(name) or {}).get("values", {}) or {}

    dur = vals("http_req_duration")
    failed = vals("http_req_failed")
    reqs = vals("http_reqs")
    vus = vals("vus_max")
    checks = vals("checks")
    sec = vals("security_findings")
    biz = vals("business_errors")
    rl = vals("rate_limited")
    oversize = vals("oversize_rejected")

    thr_ok, thr_total = True, 0
    for met in m.values():
        if isinstance(met, dict) and met.get("thresholds"):
            for t in met["thresholds"].values():
                thr_total += 1
                if isinstance(t, dict) and t.get("ok") is False:
                    thr_ok = False

    check_rate = checks.get("rate")
    return {
        "totalReqs": reqs.get("count", 0) or 0,
        "rps": _num(reqs.get("rate"), 2) or 0,
        "avg": _num(dur.get("avg"), 1),
        "p95": _num(dur.get("p(95)"), 1),
        "p99": _num(dur.get("p(99)"), 1),
        "max": _num(dur.get("max"), 1),
        "failRate": _num((failed.get("rate") or 0) * 100, 2) or 0,
        "maxVus": vus.get("max") or vus.get("value") or 0,
        "checkRate": _num((check_rate if check_rate is not None else 1) * 100, 1),
        "checkPass": checks.get("passes", 0) or 0,
        "checkFail": checks.get("fails", 0) or 0,
        "securityFindings": sec.get("count", 0) or 0,
        "bizErrors": biz.get("count", 0) or 0,
        "rateLimited": rl.get("count", 0) or 0,
        "oversizeRejected": oversize.get("count", 0) or 0,
        "thrOk": thr_ok,
        "thrTotal": thr_total,
    }


def _ms(v):
    """แสดงเวลาเป็น ms — ไม่มีค่า (เช่น ไม่มี request สำเร็จ) แสดงเป็น "—" แทนคำว่า Nonems"""
    return "—" if v is None else f"{v}ms"


def verdict(test_type, mx):
    """ตัดสิน verdict (green/yellow/red) + ข้อความ"""
    if test_type == "security":
        if mx["securityFindings"] > 0:
            return ["red", f"พบจุดน่าสงสัย {mx['securityFindings']} จุด"]
        return ["green", "ไม่พบช่องโหว่จาก payload มาตรฐาน"]
    if test_type == "fuzz":
        if mx["bizErrors"] > 0:
            return ["yellow", f"จัดการ input แปลกไม่ดี {mx['bizErrors']} ครั้ง (ตอบ 5xx/ล่ม)"]
        return ["green", "รับมือ input ผิดรูปแบบได้ดี (ไม่ crash)"]
    if test_type == "throughput":
        # bizErrors = error "จริง" (ไม่นับ 429 ที่เป็นการจำกัดอัตราอย่างถูกต้อง)
        if mx["bizErrors"] > 0:
            return ["red", f"มี error จริง {mx['bizErrors']} ครั้งขณะไต่อัตรา — เพดานจริงต่ำกว่า ~{mx['rps']} req/s"]
        if mx["rateLimited"] > 0:
            return ["yellow", f"แตะ rate limit (429) {mx['rateLimited']} ครั้ง — ระบบจำกัดอัตราที่ ~{mx['rps']} req/s"]
        return ["green", f"รับได้เฉลี่ย ~{mx['rps']} req/s โดยไม่มี error"]
    if test_type == "payload":
        if mx["bizErrors"] > 0:
            return ["red", f"จัดการ body ใหญ่ไม่ดี {mx['bizErrors']} ครั้ง (5xx/timeout/ล่ม)"]
        if mx["oversizeRejected"] > 0:
            return ["green", f"ปฏิเสธ body ใหญ่เกินด้วย 413 อย่างถูกต้อง ({mx['oversizeRejected']} ครั้ง)"]
        return ["green", "รับ body ขนาดต่างๆ ได้โดยไม่ล่ม"]
    if test_type == "breakpoint":
        # thrOk True = ไต่ครบช่วงโดยไม่ abort (ระบบรอดทั้งช่วง), False = เจอจุดพัง (abort)
        if mx["thrOk"]:
            return ["green", f"รับโหลดได้ตลอดช่วง ไต่ถึง ~{mx['maxVus']} VUs โดยไม่พัง — เพิ่ม maxRate เพื่อหาเพดานต่อ"]
        if mx["bizErrors"] > 0:
            return ["red", f"พบจุดพังที่ ~{mx['maxVus']} VUs — ระบบเริ่มตอบ error จริง {mx['bizErrors']} ครั้ง (p95 {_ms(mx['p95'])})"]
        return ["yellow", f"พบเพดานที่ ~{mx['maxVus']} VUs — ชะลอจน p95 {_ms(mx['p95'])} (ยังไม่ crash)"]
    if test_type == "defense":
        if mx["bizErrors"] > 0:
            return ["red", f"เกราะไม่ไหว: ระบบตอบ 5xx/timeout {mx['bizErrors']} ครั้งภายใต้โหลดหนัก"]
        if mx["rateLimited"] > 0:
            return ["green", f"เกราะทำงาน: จำกัดอัตราด้วย 429/503 {mx['rateLimited']} ครั้ง ระบบไม่ล่ม"]
        return ["yellow", f"ไม่พบการจำกัดอัตราภายใต้โหลด ~{mx['rps']} req/s — ระบบรับไว้ทั้งหมด (ตรวจว่ามีเกราะกัน DDoS หรือยัง)"]
    if mx["failRate"] >= 5:
        return ["red", f"error rate สูง {mx['failRate']}%"]
    if (not mx["thrOk"]) or mx["failRate"] >= 1:
        return ["yellow", f"ใกล้เกิน SLA (error {mx['failRate']}%, p95 {_ms(mx['p95'])})"]
    return ["green", f"ผ่าน SLA (error {mx['failRate']}%, p95 {_ms(mx['p95'])})"]


def aggregate(reports_dir=None, db_path=None):
    """รวมผลล่าสุดของแต่ละ type (จาก DB) เป็นโครงสร้างเดียว — ใช้ทั้ง API และ render HTML"""
    ingest(reports_dir, db_path)
    con = _connect(db_path)
    try:
        latest = {}
        for r in con.execute("SELECT test_type, ran_at, summary_json FROM runs ORDER BY ran_at, id"):
            latest[r["test_type"]] = r  # แถวหลังทับแถวก่อน → เหลือล่าสุดของแต่ละ type
        last = con.execute("SELECT base_url FROM runs WHERE base_url IS NOT NULL "
                           "ORDER BY ran_at DESC, id DESC LIMIT 1").fetchone()
    finally:
        con.close()
    base_url = last[0] if last else "—"

    rank = {"green": 0, "yellow": 1, "red": 2}
    worst = "green"
    tests = []
    for t, r in latest.items():
        mx = metrics(json.loads(r["summary_json"]))
        color, msg = verdict(t, mx)
        if rank[color] > rank[worst]:
            worst = color
        tests.append({
            "type": t,
            "label": TYPE_LABEL.get(t, t),
            "color": color,
            "verdict": msg,
            "metrics": mx,
            "ranAt": r["ran_at"],
        })

    tests.sort(key=lambda x: ORDER.index(x["type"]) if x["type"] in ORDER else 99)
    overall = {
        "green": "ระบบอยู่ในเกณฑ์ดี",
        "yellow": "มีจุดควรเฝ้าระวัง",
        "red": "มีประเด็นที่ต้องแก้ไข",
    }[worst]
    return {
        "baseUrl": base_url,
        "worst": worst,
        "overall": overall,
        "tests": tests,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    n = ingest()
    con = _connect()
    total = con.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    con.close()
    print(f"✅ นำเข้าใหม่ {n} รายการ · ทั้งหมด {total} รายการใน {DB_PATH}")
