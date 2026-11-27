#!/usr/bin/env python3
# ============================================================================
# server.py — web app ควบคุมการทดสอบ + dashboard (Python stdlib ล้วน ไม่มี dep)
#   รัน:  python3 server.py        (หรือ  make web  /  ./run.sh)
#   เปิด: http://127.0.0.1:4000
#
#   ⚠️ ผูกกับ 127.0.0.1 เท่านั้น (เครื่องตัวเอง) และยิงทดสอบได้เฉพาะ
#      เป้าหมายที่คุณได้รับอนุญาต — UI บังคับติ๊กยืนยันสิทธิ์ก่อนรัน
#
#   ยังใช้ k6 เป็นตัวรันชุดทดสอบ (tests/*.js) เหมือนเดิม; server นี้แค่สั่งรัน
#   + สตรีมผล + สรุป ส่วนเวอร์ชัน Node เดิม (server.js) ยังเก็บไว้ใช้ได้
# ============================================================================
import json
import os
import re
import sys
import threading
import queue
import subprocess
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))
from report_core import aggregate, history, ingest, REPORTS_DIR, DB_PATH  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
PORT = int(os.environ.get("PORT", "4000"))
HOST = "127.0.0.1"  # local-only เพื่อความปลอดภัย

# ชุดทดสอบที่อนุญาตให้สั่งผ่าน UI (allowlist กัน command injection)
TESTS = {
    # note = เวลาโดยประมาณตาม PROFILES ใน config/config.js (แก้คู่กันถ้าปรับ profile)
    "smoke":    {"label": "Smoke", "note": "~30 วินาที · เช็กว่าระบบตอบได้"},
    "load":     {"label": "Load", "note": "~5 นาที · ผู้ใช้คงที่"},
    "stress":   {"label": "Stress", "note": "~12 นาที · ไต่โหลดหาจุดพัง"},
    "spike":    {"label": "Spike", "note": "~6 นาที · traffic พุ่งแล้วลด"},
    "throughput": {"label": "Throughput", "note": "~3 นาที · ไต่อัตรา req/s หาเพดาน"},
    "breakpoint": {"label": "Breakpoint", "note": "สูงสุด ~15 นาที · ไต่จนพังแล้วหยุดเอง"},
    "soak":     {"label": "Soak", "note": "กำหนดเวลาเอง · หา memory leak"},
    "security": {"label": "Security (OWASP)", "note": "~30 วินาที · สแกนช่องโหว่"},
    "fuzz":     {"label": "API Fuzzing", "note": "~15 วินาที · input ผิดรูปแบบ"},
    "payload":  {"label": "Payload", "note": "~1 นาที · ส่ง body ใหญ่ (1KB→10MB)"},
    "defense":  {"label": "Defense", "note": "~1 นาที · ยิงหนักเช็กว่าเกราะ (429/503) ทำงาน"},
}

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}

# duration ต้องอยู่ในรูป เช่น 30s, 10m, 1h (กันค่าแปลกปลอม)
_DUR_RE = re.compile(r"^\d+(\.\d+)?(ms|s|m|h)$")


def _f(key, label, typ, default, **kw):
    return {"key": key, "label": label, "type": typ, "default": default, **kw}


# พารามิเตอร์ที่ปรับได้ต่อการรันแต่ละชุด (key = env var ที่ไฟล์ test อ่าน; default ควรตรงกับ PROFILES)
#   type int = ตัวเลข (มี min/max), dur = ระยะเวลาเช่น 30s/5m/1h
#   server รับเฉพาะ key ที่อยู่ในสเปกของชุดนั้น + ตรวจชนิด/ช่วง ก่อนส่งให้ k6 (กันค่าปลอม)
TEST_OPTIONS = {
    "smoke":      [_f("VUS", "จำนวนผู้ใช้ (VUs)", "int", 1, min=1, max=200),
                   _f("DURATION", "ระยะเวลา", "dur", "30s", ph="เช่น 30s, 2m")],
    "load":       [_f("VUS", "จำนวนผู้ใช้ (VUs)", "int", 50, min=1, max=2000),
                   _f("DURATION", "ระยะเวลา", "dur", "5m", ph="เช่น 5m, 30m")],
    "stress":     [_f("MAX_VUS", "VUs สูงสุด", "int", 300, min=1, max=5000),
                   _f("RAMP_MIN", "เวลาไต่ (นาที)", "int", 10, min=1, max=120)],
    "spike":      [_f("BASE_VUS", "VUs ช่วงปกติ", "int", 20, min=1, max=2000),
                   _f("PEAK_VUS", "VUs ช่วงพีค", "int", 500, min=1, max=20000)],
    "throughput": [_f("START_RATE", "เริ่มที่ (req/s)", "int", 50, min=1, max=20000),
                   _f("STEP_RATE", "เพิ่มขั้นละ (req/s)", "int", 50, min=1, max=20000),
                   _f("STEPS", "จำนวนขั้น", "int", 6, min=1, max=50),
                   _f("STAGE_SEC", "แต่ละขั้น (วินาที)", "int", 30, min=5, max=600)],
    "breakpoint": [_f("MAX_RATE", "ไต่ถึง (req/s)", "int", 2000, min=10, max=100000),
                   _f("RAMP_MIN", "เวลาไต่ (นาที)", "int", 15, min=1, max=120)],
    "soak":       [_f("VUS", "จำนวนผู้ใช้ (VUs)", "int", 40, min=1, max=2000),
                   _f("DURATION", "ระยะเวลา", "dur", "1h", ph="เช่น 1h, 30m")],
    "security":   [],
    "fuzz":       [],
    "payload":    [_f("MAX_BODY_MB", "body ใหญ่สุด (MB)", "int", 10, min=1, max=100),
                   _f("PER_SIZE", "ยิงต่อขนาด (ครั้ง)", "int", 5, min=1, max=100)],
    "defense":    [_f("RATE", "อัตรายิง (req/s)", "int", 1000, min=1, max=200000),
                   _f("SECONDS", "ระยะเวลา (วินาที)", "int", 60, min=5, max=3600)],
}


def validate_options(test, raw):
    """คัดเฉพาะ option ที่ถูกต้องของชุดนั้น คืน dict {ENV_KEY: str} สำหรับส่งให้ k6"""
    out = {}
    if not isinstance(raw, dict):
        return out
    for f in TEST_OPTIONS.get(test, []):
        v = raw.get(f["key"])
        if v is None or str(v).strip() == "":
            continue  # ไม่กรอก = ใช้ค่า default ใน config
        if f["type"] == "int":
            try:
                iv = int(float(v))
            except (TypeError, ValueError, OverflowError):  # OverflowError = inf/1e999
                continue
            if iv < f.get("min", 1) or iv > f.get("max", 10 ** 12):
                continue
            out[f["key"]] = str(iv)
        elif f["type"] == "dur":
            s = str(v).strip()
            if _DUR_RE.match(s):
                out[f["key"]] = s
    return out

_runs = {}          # runId -> Run
_runs_lock = threading.Lock()


class Run:
    def __init__(self, test, base_url):
        self.test = test
        self.base_url = base_url
        self.lines = []
        self.done = False
        self.exit_code = None
        self.listeners = []          # list[queue.Queue]
        self.lock = threading.Lock()

    def push(self, line):
        with self.lock:
            self.lines.append(line)
            for q in self.listeners:
                q.put({"type": "line", "line": line})

    def finish(self, code):
        with self.lock:
            self.done = True
            self.exit_code = code
            for q in self.listeners:
                q.put({"type": "done", "exitCode": code})

    def add_listener(self):
        q = queue.Queue()
        with self.lock:
            for line in self.lines:          # backlog ก่อน
                q.put({"type": "line", "line": line})
            if self.done:
                q.put({"type": "done", "exitCode": self.exit_code})
            else:
                self.listeners.append(q)
        return q

    def remove_listener(self, q):
        with self.lock:
            if q in self.listeners:
                self.listeners.remove(q)


def valid_url(u):
    try:
        x = urlparse(u)
        return x.scheme in ("http", "https") and bool(x.netloc)
    except Exception:
        return False


def start_run(test, base_url, auth_token="", extra_env=None):
    run = Run(test, base_url)
    run_id = str(uuid.uuid4())
    with _runs_lock:
        _runs[run_id] = run

    args = ["k6", "run", "-e", f"TEST_TYPE={test}", "-e", f"BASE_URL={base_url}"]
    shown = list(args)  # สำเนาไว้โชว์ใน log โดยปิดบัง token
    env = dict(os.environ, TEST_TYPE=test, BASE_URL=base_url)
    if auth_token:
        args += ["-e", f"AUTH_TOKEN={auth_token}"]
        shown += ["-e", "AUTH_TOKEN=***"]  # ไม่โชว์ token จริงใน log
        env["AUTH_TOKEN"] = auth_token
    for k, v in (extra_env or {}).items():      # พารามิเตอร์จากหน้าเว็บ (ตรวจแล้วใน validate_options)
        args += ["-e", f"{k}={v}"]
        shown += ["-e", f"{k}={v}"]
        env[k] = v
    args.append(os.path.join("tests", f"{test}.js"))
    shown.append(os.path.join("tests", f"{test}.js"))

    run.push(f"▶ เริ่ม {test} → {base_url}")
    run.push("  คำสั่ง: " + " ".join(shown))

    def worker():
        try:
            proc = subprocess.Popen(
                args, cwd=ROOT, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                bufsize=1, text=True,
            )
        except FileNotFoundError:
            run.push("❌ เรียก k6 ไม่ได้ — ติดตั้ง k6 ก่อน (brew install k6)")
            run.finish(-1)
            return
        except Exception as e:  # noqa: BLE001
            run.push(f"❌ {e}")
            run.finish(-1)
            return
        for line in proc.stdout:
            run.push(line.rstrip("\n"))
        code = proc.wait()
        try:
            if ingest():
                run.push(f"💾 บันทึกผลลง {os.path.relpath(DB_PATH, ROOT)} แล้ว")
        except Exception as e:  # noqa: BLE001 — DB พังต้องไม่ทำให้ผลการรันหาย (JSON ยังอยู่)
            run.push(f"⚠️ บันทึกลง SQLite ไม่สำเร็จ: {e} (ไฟล์ JSON ยังอยู่ใน reports/)")
        run.push("")
        run.push("✅ เสร็จสมบูรณ์" if code == 0
                 else f"⚠️ จบด้วย exit code {code} (ดูผลที่บันทึกไว้ได้ในแดชบอร์ด)")
        run.finish(code)

    threading.Thread(target=worker, daemon=True).start()
    return run_id


def _allowed_hosts():
    """Host/Origin ที่ยอมรับ — กัน DNS rebinding และเว็บอื่นสั่งรันข้ามโดเมน (CSRF)"""
    hosts = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
    if PORT == 80:
        hosts |= {"127.0.0.1", "localhost"}
    return hosts


def host_ok(host):
    return (host or "").strip().lower() in _allowed_hosts()


def origin_ok(origin):
    """ไม่มี Origin (เช่น curl) = ผ่าน; มี Origin ต้องเป็นหน้าเว็บของ server นี้เท่านั้น"""
    if not origin:
        return True
    x = urlparse(origin.strip().lower())
    return x.scheme == "http" and x.netloc in _allowed_hosts()


def _str(v):
    """ค่าจาก JSON ที่ควรเป็นข้อความ — ชนิดอื่นถือเป็นค่าว่าง"""
    return v.strip() if isinstance(v, str) else ""


def read_config_default():
    default = "http://localhost:8080"
    try:
        with open(os.path.join(ROOT, "config", "config.js"), encoding="utf-8") as fh:
            m = re.search(r"BASE_URL\s*=\s*__ENV\.BASE_URL\s*\|\|\s*'([^']+)'", fh.read())
            if m:
                default = m.group(1)
    except OSError:
        pass
    return default


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ปิด log รายบรรทัดของ stdlib ให้เงียบลง
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        try:
            with open(path, "rb") as fh:
                body = fh.read()
        except OSError:
            return self._plain(404, b"not found")
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(os.path.splitext(path)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n < 0 or n > 1_000_000:  # ค่าติดลบทำให้ read() รอจนกว่าจะปิด connection
                return {}
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, UnicodeDecodeError):  # JSONDecodeError เป็น subclass ของ ValueError
            return {}
        return body if isinstance(body, dict) else {}  # [] / "x" / null ต้องไม่ทำให้ handler พัง

    def _plain(self, code, text=b""):
        # HTTP/1.1 keep-alive: ต้องมี Content-Length ไม่งั้น client รอค้างไม่รู้ว่าคำตอบจบเมื่อไร
        self.send_response(code)
        self.send_header("Content-Length", str(len(text)))
        self.end_headers()
        self.wfile.write(text)

    # ------------------------------------------------------------------ GET
    def _forbidden(self, msg):
        return self._json(403, {"error": msg})

    def do_GET(self):
        if not host_ok(self.headers.get("Host")):
            return self._forbidden("Host ไม่ถูกต้อง — เปิดผ่าน http://127.0.0.1:%d เท่านั้น" % PORT)
        p = urlparse(self.path).path

        if p in ("/", "/index.html"):
            return self._file(os.path.join(WEB, "index.html"))
        if p in ("/dashboard", "/dashboard.html"):
            return self._file(os.path.join(WEB, "dashboard.html"))
        if p.startswith("/web/"):
            safe = os.path.normpath(p[len("/web/"):]).lstrip("/.")
            full = os.path.join(WEB, safe)
            if not os.path.abspath(full).startswith(WEB):
                return self._plain(403)
            return self._file(full)

        if p == "/api/config":
            return self._json(200, {"tests": TESTS, "options": TEST_OPTIONS,
                                    "defaultBaseUrl": read_config_default()})

        if p == "/api/dashboard":
            return self._json(200, aggregate())

        if p == "/api/history":
            return self._json(200, {"items": history()})

        if p.startswith("/api/stream/"):
            return self._stream(p.rsplit("/", 1)[-1])

        self._plain(404, b"not found")

    # ----------------------------------------------------------------- POST
    def do_POST(self):
        # กันเว็บอื่นสั่งรัน k6 ผ่านเบราว์เซอร์ของผู้ใช้ (CSRF / DNS rebinding):
        #   Host ต้องเป็น server นี้, Origin (ถ้ามี) ต้องเป็นหน้าเว็บนี้, และต้องเป็น JSON
        #   (application/json บังคับให้เบราว์เซอร์ทำ CORS preflight ซึ่ง server ไม่อนุญาต)
        if not host_ok(self.headers.get("Host")):
            return self._forbidden("Host ไม่ถูกต้อง")
        if not origin_ok(self.headers.get("Origin")):
            return self._forbidden("ไม่อนุญาตคำขอจากเว็บอื่น")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return self._json(415, {"error": "ต้องส่งเป็น application/json"})
        p = urlparse(self.path).path
        if p == "/api/run":
            b = self._read_body()
            test = b.get("test")
            base_url = _str(b.get("baseUrl"))
            if not isinstance(test, str) or test not in TESTS:  # list/dict จะ unhashable
                return self._json(400, {"error": "ชุดทดสอบไม่ถูกต้อง"})
            if not valid_url(base_url):
                return self._json(400, {"error": "BASE_URL ต้องเป็น http(s) ที่ถูกต้อง"})
            if not b.get("authorized"):
                return self._json(400, {"error": "ต้องยืนยันว่าได้รับอนุญาตให้ทดสอบเป้าหมายนี้ก่อน"})
            opts = validate_options(test, b.get("options") or {})
            run_id = start_run(test, base_url, _str(b.get("authToken")), opts)
            return self._json(200, {"runId": run_id})

        self._plain(404)

    # --------------------------------------------------------------- SSE
    def _stream(self, run_id):
        with _runs_lock:
            run = _runs.get(run_id)
        if not run:
            return self._plain(404)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = run.add_listener()
        try:
            while True:
                try:
                    ev = q.get(timeout=20)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")  # กัน proxy ตัดการเชื่อมต่อ
                    self.wfile.flush()
                    continue
                self.wfile.write(f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
                if ev.get("type") == "done":
                    break
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            run.remove_listener(q)
            self.close_connection = True  # คำตอบไม่มี Content-Length ต้องปิด connection เพื่อบอกว่าจบ


def main():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("==================================================")
    print("  rx_k6 web app (Python) พร้อมใช้งาน")
    print(f"  เปิด:       http://{HOST}:{PORT}")
    print(f"  dashboard:  http://{HOST}:{PORT}/dashboard")
    print("  ⚠️ ทดสอบเฉพาะระบบที่คุณได้รับอนุญาตเท่านั้น")
    print("  หยุด: Ctrl+C")
    print("==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nปิดเซิร์ฟเวอร์")
        httpd.shutdown()


if __name__ == "__main__":
    main()
