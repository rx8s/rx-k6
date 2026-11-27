#!/usr/bin/env python3
# ทดสอบ make_report.py:  python3 scripts/test_make_report.py
#   - ใช้ไดเรกทอรี/DB ชั่วคราว ไม่แตะ reports/ จริง
#   - ตรวจว่ารายงานมีทุกชุดทดสอบ, คอลัมน์ "Checks/พบ" ถูกตามชนิด, ค่า None แสดงเป็น "—",
#     ข้อมูลจาก DB ถูก escape และ main() จัดการกรณีไม่มีผล/มีผลได้ถูกต้อง
import contextlib
import io
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_report as mr  # noqa: E402
import report_core as rc  # noqa: E402


def summary(test_type, ran_at, **extra):
    """summary ของ k6 แบบย่อ — extra = metric แบบ counter เพิ่มเติม เช่น security_findings=3"""
    m = {
        "http_req_duration": {"values": {"avg": 100, "p(95)": 200, "p(99)": 300, "max": 400}},
        "http_req_failed": {"values": {"rate": 0.0}},
        "http_reqs": {"values": {"count": 1234, "rate": 5}},
        "vus_max": {"values": {"max": 10}},
        "checks": {"values": {"rate": 0.98, "passes": 98, "fails": 2}},
    }
    for name, count in extra.items():
        m[name] = {"values": {"count": count}}
    return {"metrics": m, "rx_meta": {"testType": test_type, "baseUrl": "http://localhost:8080", "ranAt": ran_at}}


def row_of(html_text, label):
    """ดึงแถว <tr> ในตารางของชุดนี้ คืนรายการข้อความใน <td>"""
    for tr in re.findall(r"<tr>(.*?)</tr>", html_text, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if cells and cells[0] == label:
            return cells
    raise AssertionError(f"ไม่พบแถวของ {label}")


with tempfile.TemporaryDirectory() as d:
    db = os.path.join(d, "results.db")

    def write(name, data):
        with open(os.path.join(d, name), "w", encoding="utf-8") as f:
            json.dump(data, f)

    # --- main() เมื่อยังไม่มีผล: ออกด้วย exit 1 และไม่สร้างไฟล์
    out = os.path.join(d, "executive-report.html")
    mr.OUT = out
    mr.aggregate = lambda: rc.aggregate(d, db)
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        try:
            mr.main()
            raise AssertionError("ไม่มีผลต้อง exit 1")
        except SystemExit as e:
            assert e.code == 1, e.code
    assert not os.path.exists(out), "ไม่มีผลต้องไม่สร้างรายงาน"
    assert "ยังไม่มีผล" in err.getvalue()

    # --- มีผลหลายชนิด
    write("load-1.json", summary("load", "2026-11-27T01:00:00.000Z"))
    write("security-1.json", summary("security", "2026-11-27T01:01:00.000Z", security_findings=3))
    write("fuzz-1.json", summary("fuzz", "2026-11-27T01:02:00.000Z", business_errors=2))
    write("defense-1.json", summary("defense", "2026-11-27T01:03:00.000Z", rate_limited=50))
    # ชนิดที่ไม่มีใน TYPE_LABEL → label = test_type ดิบ ต้องถูก escape
    write("evil-1.json", summary("<script>alert(1)</script>", "2026-11-27T01:04:00.000Z"))
    # ไม่มี latency (None) → ต้องแสดง "—"
    nolat = summary("smoke", "2026-11-27T01:05:00.000Z")
    del nolat["metrics"]["http_req_duration"]
    write("smoke-1.json", nolat)

    agg = rc.aggregate(d, db)
    page = mr.render(agg)

    # ทุกชุดมีการ์ด
    assert len(re.findall(r'<div class="card ', page)) == len(agg["tests"]) == 6

    # คอลัมน์สุดท้าย "Checks/พบ" เปลี่ยนตามชนิด
    assert row_of(page, rc.TYPE_LABEL["load"])[-1] == "98.0%"
    assert row_of(page, rc.TYPE_LABEL["security"])[-1] == "3"
    assert row_of(page, rc.TYPE_LABEL["fuzz"])[-1] == "2"
    assert row_of(page, rc.TYPE_LABEL["defense"])[-1] == "50"
    load_row = row_of(page, rc.TYPE_LABEL["load"])
    assert load_row[2] == "1,234" and load_row[4] == "200.0" and load_row[5] == "300.0", load_row

    # ค่า None แสดงเป็น "—" ไม่ใช่ "None"
    smoke_row = row_of(page, rc.TYPE_LABEL["smoke"])
    assert smoke_row[4] == "—" and smoke_row[5] == "—", smoke_row
    assert "None" not in page

    # escape ข้อมูลจาก DB
    assert "<script>alert(1)</script>" not in page
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in page

    # ผลโดยรวม = สีที่แย่ที่สุด (security พบ 3 จุด → แดง) + เป้าหมายจาก DB
    assert agg["worst"] == "red" and 'class="verdict red"' in page
    assert "http://localhost:8080" in page

    # --- main() เมื่อมีผล: เขียนไฟล์ HTML ที่ครบ
    with contextlib.redirect_stdout(io.StringIO()):
        mr.main()
    with open(out, encoding="utf-8") as fh:
        written = fh.read()
    assert written.startswith("<!doctype html>") and written.rstrip().endswith("</html>")
    assert rc.TYPE_LABEL["security"] in written

print("OK — make_report tests passed")
