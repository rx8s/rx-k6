#!/usr/bin/env python3
# ============================================================================
# report_core.py — logic อ่าน/สรุปผล k6 ที่ใช้ร่วมกัน (make_report.py + server.py)
#   พอร์ตมาจาก scripts/report-core.js (ฝั่ง Node) ให้ผลเหมือนกัน
# ============================================================================
import json
import os
import re
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(ROOT, "reports")

TYPE_LABEL = {
    "smoke": "Smoke (เช็กเบื้องต้น)",
    "load": "Load (โหลดปกติ)",
    "stress": "Stress (หาจุดพัง)",
    "spike": "Spike (traffic พุ่ง)",
    "soak": "Soak (รันยาว)",
    "security": "Security (OWASP)",
    "fuzz": "API Fuzzing",
}

ORDER = ["smoke", "load", "stress", "spike", "soak", "security", "fuzz"]

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


def load_latest_per_type():
    """อ่านไฟล์ผลล่าสุดของแต่ละ test type"""
    if not os.path.isdir(REPORTS_DIR):
        return {}
    by_type = {}
    for f in os.listdir(REPORTS_DIR):
        if not f.endswith(".json") or f in ("latest.json", "executive-report.json"):
            continue
        m = _DATE_RE.split(f)
        test_type = m[0]
        full = os.path.join(REPORTS_DIR, f)
        mtime = os.path.getmtime(full)
        if test_type not in by_type or mtime > by_type[test_type]["mtime"]:
            by_type[test_type] = {"mtime": mtime, "file": full, "name": f}
    result = {}
    for t, info in by_type.items():
        try:
            with open(info["file"], encoding="utf-8") as fh:
                info = {**info, "data": json.load(fh)}
            result[t] = info
        except (OSError, json.JSONDecodeError):
            pass
    return result


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
        "thrOk": thr_ok,
        "thrTotal": thr_total,
    }


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
    if mx["failRate"] >= 5:
        return ["red", f"error rate สูง {mx['failRate']}%"]
    if (not mx["thrOk"]) or mx["failRate"] >= 1:
        return ["yellow", f"ใกล้เกิน SLA (error {mx['failRate']}%, p95 {mx['p95']}ms)"]
    return ["green", f"ผ่าน SLA (error {mx['failRate']}%, p95 {mx['p95']}ms)"]


def aggregate():
    """รวมทุก type เป็นโครงสร้างเดียว (ใช้ได้ทั้ง API และ render HTML)"""
    all_runs = load_latest_per_type()

    base_url = "—"
    latest = os.path.join(REPORTS_DIR, "latest.json")
    if os.path.isfile(latest):
        try:
            with open(latest, encoding="utf-8") as fh:
                base_url = json.load(fh).get("baseUrl") or "—"
        except (OSError, json.JSONDecodeError):
            pass

    rank = {"green": 0, "yellow": 1, "red": 2}
    worst = "green"
    tests = []
    for t, info in all_runs.items():
        mx = metrics(info["data"])
        color, msg = verdict(t, mx)
        if rank[color] > rank[worst]:
            worst = color
        tests.append({
            "type": t,
            "label": TYPE_LABEL.get(t, t),
            "color": color,
            "verdict": msg,
            "metrics": mx,
            "ranAt": datetime.fromtimestamp(info["mtime"], timezone.utc).isoformat(),
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
