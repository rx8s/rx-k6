#!/usr/bin/env python3
# ทดสอบการนำผล k6 เข้า SQLite:  python3 scripts/test_report_core.py
import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import report_core as rc  # noqa: E402


def summary(p99, fail_rate, ran_at):
    return {
        "metrics": {
            "http_req_duration": {"values": {"avg": 100, "p(95)": 200, "p(99)": p99, "max": 400}},
            "http_req_failed": {"values": {"rate": fail_rate}},
            "http_reqs": {"values": {"count": 50, "rate": 5}},
            "vus_max": {"values": {"max": 10}},
        },
        "rx_meta": {"testType": "load", "baseUrl": "http://localhost:8080", "ranAt": ran_at},
    }


with tempfile.TemporaryDirectory() as d:
    db = os.path.join(d, "results.db")

    def write(name, data):
        with open(os.path.join(d, name), "w") as f:
            json.dump(data, f)

    write("load-2026-11-24T05-00-00-000Z.json", summary(300, 0.02, "2026-11-24T05:00:00.000Z"))
    write("latest.json", {"ignored": True})

    assert rc.ingest(d, db) == 1, "ต้องนำเข้า 1 ไฟล์ (ข้าม latest.json)"
    assert rc.ingest(d, db) == 0, "รันซ้ำต้องไม่นำเข้าซ้ำ"

    con = sqlite3.connect(db)
    row = con.execute("SELECT test_type, base_url, ran_at, p99_ms, fail_rate FROM runs").fetchone()
    con.close()
    assert row == ("load", "http://localhost:8080", "2026-11-24T05:00:00+00:00", 300.0, 2.0), row

    # รันใหม่กว่า → แดชบอร์ดต้องใช้ตัวล่าสุด แต่ประวัติเก็บครบทั้งสอง
    write("load-2026-11-24T06-00-00-000Z.json", summary(500, 0.0, "2026-11-24T06:00:00.000Z"))
    agg = rc.aggregate(d, db)
    t = agg["tests"][0]
    assert len(agg["tests"]) == 1 and t["metrics"]["p99"] == 500 and t["color"] == "green", t
    assert agg["baseUrl"] == "http://localhost:8080"
    assert [h["metrics"]["p99"] for h in rc.history(reports_dir=d, db_path=db)] == [500, 300]

print("OK — report_core SQLite tests passed")
