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
    "soak":     {"label": "Soak", "note": "กำหนดเวลาเอง · หา memory leak"},
    "security": {"label": "Security (OWASP)", "note": "~30 วินาที · สแกนช่องโหว่"},
    "fuzz":     {"label": "API Fuzzing", "note": "~15 วินาที · input ผิดรูปแบบ"},
}

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}

# soak duration ต้องอยู่ในรูป เช่น 30s, 10m, 1h (กันค่าแปลกปลอม)
_DUR_RE = re.compile(r"^\d+(\.\d+)?(ms|s|m|h)$")

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


def start_run(test, base_url, auth_token="", soak_duration=""):
    run = Run(test, base_url)
    run_id = str(uuid.uuid4())
    with _runs_lock:
        _runs[run_id] = run

    args = ["k6", "run", "-e", f"TEST_TYPE={test}", "-e", f"BASE_URL={base_url}"]
    env = dict(os.environ, TEST_TYPE=test, BASE_URL=base_url)
    if auth_token:
        args += ["-e", f"AUTH_TOKEN={auth_token}"]
        env["AUTH_TOKEN"] = auth_token
    if test == "soak" and soak_duration and _DUR_RE.match(soak_duration):
        args += ["-e", f"SOAK_DURATION={soak_duration}"]
        env["SOAK_DURATION"] = soak_duration
    args.append(os.path.join("tests", f"{test}.js"))

    run.push(f"▶ เริ่ม {test} → {base_url}")
    run.push("  คำสั่ง: " + " ".join(args))

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
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(os.path.splitext(path)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 1_000_000:
                return {}
            return json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return {}

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        p = urlparse(self.path).path

        if p in ("/", "/index.html"):
            return self._file(os.path.join(WEB, "index.html"))
        if p in ("/dashboard", "/dashboard.html"):
            return self._file(os.path.join(WEB, "dashboard.html"))
        if p.startswith("/web/"):
            safe = os.path.normpath(p[len("/web/"):]).lstrip("/.")
            full = os.path.join(WEB, safe)
            if not os.path.abspath(full).startswith(WEB):
                self.send_response(403); self.end_headers(); return
            return self._file(full)

        if p == "/api/config":
            return self._json(200, {"tests": TESTS, "defaultBaseUrl": read_config_default()})

        if p == "/api/dashboard":
            return self._json(200, aggregate())

        if p == "/api/history":
            return self._json(200, {"items": history()})

        if p.startswith("/api/stream/"):
            return self._stream(p.rsplit("/", 1)[-1])

        self.send_response(404); self.end_headers(); self.wfile.write(b"not found")

    # ----------------------------------------------------------------- POST
    def do_POST(self):
        p = urlparse(self.path).path
        if p == "/api/run":
            b = self._read_body()
            test = b.get("test")
            base_url = (b.get("baseUrl") or "").strip()
            if test not in TESTS:
                return self._json(400, {"error": "ชุดทดสอบไม่ถูกต้อง"})
            if not valid_url(base_url):
                return self._json(400, {"error": "BASE_URL ต้องเป็น http(s) ที่ถูกต้อง"})
            if not b.get("authorized"):
                return self._json(400, {"error": "ต้องยืนยันว่าได้รับอนุญาตให้ทดสอบเป้าหมายนี้ก่อน"})
            run_id = start_run(test, base_url, (b.get("authToken") or "").strip(),
                               (b.get("soakDuration") or "").strip())
            return self._json(200, {"runId": run_id})

        self.send_response(404); self.end_headers()

    # --------------------------------------------------------------- SSE
    def _stream(self, run_id):
        with _runs_lock:
            run = _runs.get(run_id)
        if not run:
            self.send_response(404); self.end_headers(); return

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
