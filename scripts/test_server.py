#!/usr/bin/env python3
# ทดสอบ server.py:  python3 scripts/test_server.py
#   - ไม่รัน k6 จริง (แทน subprocess.Popen ด้วยตัวปลอม) และไม่แตะ reports/results.db (แทน ingest)
#   - เปิด server จริงบนพอร์ตสุ่มที่ 127.0.0.1 แล้วยิงคำขอด้วย http.client
#   ครอบคลุมส่วนที่สำคัญด้านความปลอดภัย: allowlist ชุดทดสอบ, ตรวจ Host/Origin/Content-Type,
#   ตรวจพารามิเตอร์, การปิดบัง AUTH_TOKEN ใน log และกัน path traversal ใน /web/
import http.client
import json
import os
import queue
import sys
import threading
import traceback
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402


# ------------------------------------------------------------ ตัวปลอมของ k6
class FakeProc:
    def __init__(self, lines, code):
        self.stdout = iter(line + "\n" for line in lines)
        self._code = code

    def wait(self):
        return self._code


class FakePopen:
    """บันทึก args/env ที่ส่งให้ k6 แทนการรันจริง"""
    calls = []

    def __init__(self, args, **kw):
        FakePopen.calls.append({"args": args, **kw})
        self._proc = FakeProc(["k6 output line"], 0)
        self.stdout = self._proc.stdout

    def wait(self):
        return self._proc.wait()


server.subprocess.Popen = FakePopen
server.ingest = lambda: 0


def wait_done(run_id, timeout=5):
    """รอให้ worker ของ run จบ คืนรายการบรรทัด log ทั้งหมด"""
    with server._runs_lock:
        run = server._runs[run_id]
    q = run.add_listener()
    lines = []
    while True:
        ev = q.get(timeout=timeout)
        if ev["type"] == "done":
            return lines, ev["exitCode"]
        lines.append(ev["line"])


# --------------------------------------------------------- server จริงบนพอร์ตสุ่ม
httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
server.PORT = httpd.server_address[1]  # host_ok/origin_ok อ่านค่านี้ตอนเรียก
threading.Thread(target=httpd.serve_forever, daemon=True).start()
HOST = f"127.0.0.1:{server.PORT}"


def req(method, path, body=None, headers=None, raw=None):
    """ยิงคำขอ คืน (status, body str); ใส่ Host เองได้ผ่าน headers"""
    h = {"Host": HOST}
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    data = raw if raw is not None else (json.dumps(body) if body is not None else None)
    conn = http.client.HTTPConnection("127.0.0.1", server.PORT, timeout=5)
    try:
        conn.request(method, path, body=data, headers=h)
        r = conn.getresponse()
        return r.status, r.read().decode("utf-8", "replace")
    finally:
        conn.close()


def run_body(**kw):
    b = {"test": "smoke", "baseUrl": "http://localhost:8080", "authorized": True}
    b.update(kw)
    return b


# ================================================================ เทสต์ทั้งหมด
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


# ---------- allowlist และความสอดคล้องของ config
@test
def tests_allowlist_matches_files_and_options():
    assert set(server.TESTS) == set(server.TEST_OPTIONS), "TESTS กับ TEST_OPTIONS ต้องมี key ตรงกัน"
    for name in server.TESTS:
        assert os.path.isfile(os.path.join(ROOT, "tests", f"{name}.js")), f"ไม่มี tests/{name}.js"
        for f in server.TEST_OPTIONS[name]:
            if f["type"] == "int":
                assert f["min"] <= f["default"] <= f["max"], f"{name}.{f['key']} default อยู่นอกช่วง"
            else:
                assert server._DUR_RE.match(f["default"]), f"{name}.{f['key']} default ไม่ใช่ duration"


# ---------- validate_options
@test
def validate_options_filters_and_coerces():
    v = server.validate_options
    assert v("load", {"VUS": "25", "DURATION": "2m"}) == {"VUS": "25", "DURATION": "2m"}
    assert v("load", {"VUS": 10.7}) == {"VUS": "10"}
    assert v("load", {"VUS": " "}) == {}, "ค่าว่าง = ใช้ default"
    assert v("load", {"VUS": 0}) == {}, "ต่ำกว่า min"
    assert v("load", {"VUS": 999999}) == {}, "เกิน max"
    assert v("load", {"VUS": "abc"}) == {}
    assert v("load", {"VUS": [1]}) == {}
    assert v("load", {"EVIL": "1", "PATH": "/tmp"}) == {}, "key ที่ไม่อยู่ในสเปกต้องถูกทิ้ง"
    assert v("smoke", {"MAX_VUS": "10"}) == {}, "key ของชุดอื่นต้องถูกทิ้ง"
    assert v("security", {"VUS": "5"}) == {}
    assert v("nope", {"VUS": "5"}) == {}
    assert v("load", "VUS=5") == {}
    assert v("load", None) == {}


@test
def validate_options_rejects_non_finite_numbers():
    for bad in ("inf", "-inf", "nan", "1e999", float("inf"), float("nan")):
        assert server.validate_options("load", {"VUS": bad}) == {}, f"ต้องทิ้ง {bad!r}"


@test
def validate_options_duration_format():
    v = server.validate_options
    for ok in ("30s", "5m", "1h", "1.5m", "250ms", " 2m "):
        assert v("load", {"DURATION": ok}) == {"DURATION": ok.strip()}, ok
    for bad in ("5", "5 m", "5m; rm -rf /", "-5m", "5d", "m", "5m\nx", "$(id)"):
        assert v("load", {"DURATION": bad}) == {}, f"ต้องทิ้ง {bad!r}"


# ---------- valid_url / host_ok / origin_ok
@test
def valid_url_only_http_https():
    assert server.valid_url("http://localhost:8080")
    assert server.valid_url("https://example.test/api")
    for bad in ("", "localhost:8080", "ftp://x", "file:///etc/passwd", "javascript:alert(1)", "http://"):
        assert not server.valid_url(bad), bad


@test
def host_and_origin_checks():
    p = server.PORT
    assert server.host_ok(f"127.0.0.1:{p}") and server.host_ok(f"LOCALHOST:{p}")
    for bad in (None, "", "127.0.0.1", f"evil.com:{p}", f"127.0.0.1:{p}.evil.com", f"0.0.0.0:{p}"):
        assert not server.host_ok(bad), bad
    assert server.origin_ok(None) and server.origin_ok("")
    assert server.origin_ok(f"http://127.0.0.1:{p}") and server.origin_ok(f"http://localhost:{p}")
    for bad in ("null", "http://evil.com", f"https://127.0.0.1:{p}", f"http://127.0.0.1:{p}.evil.com",
                f"http://evil.com/?http://127.0.0.1:{p}"):
        assert not server.origin_ok(bad), bad


# ---------- start_run: คำสั่งที่ส่งให้ k6
@test
def start_run_builds_args_and_masks_token():
    FakePopen.calls.clear()
    rid = server.start_run("load", "http://localhost:8080", "s3cret-token", {"VUS": "5"})
    lines, code = wait_done(rid)
    assert code == 0
    call = FakePopen.calls[-1]
    args = call["args"]
    assert isinstance(args, list), "ต้องส่ง args เป็น list (ไม่ผ่าน shell)"
    assert call.get("shell") in (None, False)
    assert args[:2] == ["k6", "run"] and args[-1] == os.path.join("tests", "load.js")
    assert "AUTH_TOKEN=s3cret-token" in args and "VUS=5" in args
    assert call["env"]["AUTH_TOKEN"] == "s3cret-token"
    log = "\n".join(lines)
    assert "s3cret-token" not in log, "token จริงต้องไม่โผล่ใน log สด"
    assert "AUTH_TOKEN=***" in log
    assert "k6 output line" in log and "เสร็จสมบูรณ์" in log


@test
def start_run_reports_missing_k6():
    def boom(*a, **kw):
        raise FileNotFoundError("k6")
    server.subprocess.Popen = boom
    try:
        lines, code = wait_done(server.start_run("smoke", "http://localhost:8080"))
    finally:
        server.subprocess.Popen = FakePopen
    assert code == -1 and any("ติดตั้ง k6" in x for x in lines)


# ---------- HTTP: GET
@test
def http_get_pages_and_config():
    s, body = req("GET", "/")
    assert s == 200 and "<html" in body.lower()
    s, body = req("GET", "/api/config")
    cfg = json.loads(body)
    assert s == 200 and set(cfg["tests"]) == set(server.TESTS) and cfg["defaultBaseUrl"].startswith("http")
    assert req("GET", "/nope")[0] == 404


@test
def http_get_rejects_bad_host():
    for h in ("evil.com", f"evil.com:{server.PORT}", "127.0.0.1:1"):
        s, _ = req("GET", "/api/config", headers={"Host": h})
        assert s == 403, h


@test
def http_web_static_no_path_traversal():
    assert req("GET", "/web/styles.css")[0] == 200
    for p in ("/web/../server.py", "/web/../../etc/passwd", "/web/..%2fserver.py",
              "/web/%2e%2e/server.py", "/web//etc/passwd"):
        s, body = req("GET", p)
        assert s in (403, 404), f"{p} → {s}"
        assert "ThreadingHTTPServer" not in body and "root:" not in body, p


# ---------- HTTP: POST /api/run
@test
def http_run_success_passes_only_valid_options():
    captured = {}
    orig = server.start_run

    def fake_start(test, base_url, token="", extra=None):
        captured.update(test=test, base_url=base_url, token=token, extra=extra)
        return "fake-id"
    server.start_run = fake_start
    try:
        s, body = req("POST", "/api/run", run_body(
            test="load", baseUrl="  http://localhost:8080  ", authToken=" t ",
            options={"VUS": "7", "DURATION": "bad", "EVIL": "x"}))
    finally:
        server.start_run = orig
    assert s == 200 and json.loads(body) == {"runId": "fake-id"}
    assert captured == {"test": "load", "base_url": "http://localhost:8080",
                        "token": "t", "extra": {"VUS": "7"}}


@test
def http_run_rejects_invalid_requests():
    cases = [
        (run_body(test="../../etc/passwd"), 400),
        (run_body(test="smoke; rm -rf /"), 400),
        (run_body(test=None), 400),
        (run_body(baseUrl="file:///etc/passwd"), 400),
        (run_body(baseUrl=""), 400),
        (run_body(authorized=False), 400),
        ({k: v for k, v in run_body().items() if k != "authorized"}, 400),
    ]
    for body, want in cases:
        s, _ = req("POST", "/api/run", body)
        assert s == want, f"{body} → {s}"


@test
def http_run_survives_malformed_json_types():
    # ค่าผิดชนิดต้องได้ 400 ไม่ใช่ handler พัง (ปิด connection โดยไม่ตอบ)
    for body in (run_body(test=["smoke"]), run_body(test={"a": 1}),
                 run_body(baseUrl=123), run_body(authToken=["x"]), run_body(options={"VUS": "inf"})):
        s, _ = req("POST", "/api/run", body)
        assert s in (200, 400), f"{body} → {s}"
    for raw in ("[]", '"smoke"', "123", "null", "{not json"):
        s, _ = req("POST", "/api/run", raw=raw, headers={"Content-Type": "application/json"})
        assert s == 400, f"{raw!r} → {s}"


@test
def http_run_blocks_cross_origin_and_non_json():
    s, _ = req("POST", "/api/run", run_body(), headers={"Origin": "http://evil.com"})
    assert s == 403
    s, _ = req("POST", "/api/run", run_body(), headers={"Host": "evil.com"})
    assert s == 403
    s, _ = req("POST", "/api/run", raw=json.dumps(run_body()), headers={"Content-Type": "text/plain"})
    assert s == 415, "text/plain ข้าม CORS preflight ได้ ต้องปฏิเสธ"
    s, _ = req("POST", "/api/run", raw=json.dumps(run_body()),
               headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert s == 415
    s, _ = req("POST", "/api/run", run_body(test="nope"), headers={"Origin": f"http://localhost:{server.PORT}"})
    assert s == 400, "Origin ของหน้าเว็บนี้เองต้องผ่านด่าน Origin"


# ---------- SSE
@test
def http_stream_replays_finished_run():
    rid = server.start_run("smoke", "http://localhost:8080")
    wait_done(rid)
    s, body = req("GET", f"/api/stream/{rid}")
    assert s == 200
    events = [json.loads(x[len("data: "):]) for x in body.split("\n\n") if x.startswith("data: ")]
    assert events[-1] == {"type": "done", "exitCode": 0}
    assert any(e.get("line") == "k6 output line" for e in events)
    assert req("GET", "/api/stream/no-such-run")[0] == 404


# ================================================================== runner
failed = 0
for fn in TESTS:
    try:
        fn()
        print(f"  ✓ {fn.__name__}")
    except Exception:  # noqa: BLE001
        failed += 1
        print(f"  ✗ {fn.__name__}")
        traceback.print_exc()

httpd.shutdown()
if failed:
    print(f"FAILED — {failed}/{len(TESTS)} server tests failed")
    sys.exit(1)
print(f"OK — server tests passed ({len(TESTS)})")
