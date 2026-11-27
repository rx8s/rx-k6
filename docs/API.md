# HTTP API ของ web app

เซิร์ฟเวอร์ (`server.py`) เปิดที่ `http://127.0.0.1:4000` (เปลี่ยนได้ด้วย `PORT`)
ผูกกับ localhost เท่านั้น ไม่มีระบบล็อกอิน ทุก response เป็น JSON แบบ UTF-8 เว้นแต่ระบุไว้

| Method | Path | ใช้ทำอะไร |
|--------|------|-----------|
| GET | `/` , `/dashboard` | หน้าควบคุม / หน้าแดชบอร์ด |
| GET | `/web/<file>` | ไฟล์ static ใน `web/` |
| GET | `/api/config` | รายการชุดทดสอบ + BASE_URL ค่าเริ่มต้น |
| POST | `/api/run` | สั่งรันชุดทดสอบ |
| GET | `/api/stream/<runId>` | สตรีม log ของการรัน (SSE) |
| GET | `/api/dashboard` | ผลล่าสุดของแต่ละชุด + สถานะรวม |
| GET | `/api/history` | ประวัติการรันทั้งหมด (ใหม่สุดก่อน) |

### การกันคำขอจากเว็บอื่น (ทุก endpoint)

กันเว็บอื่นสั่งรัน k6 ผ่านเบราว์เซอร์ของผู้ใช้ (CSRF / DNS rebinding):

- **ทุกคำขอ** — header `Host` ต้องเป็น `127.0.0.1:<PORT>` หรือ `localhost:<PORT>` ไม่งั้นได้ `403`
- **POST** — ถ้ามี header `Origin` ต้องเป็น `http://127.0.0.1:<PORT>` หรือ `http://localhost:<PORT>`
  ไม่งั้นได้ `403` (ไม่มี `Origin` เช่น curl = ผ่าน)
- **POST** — `Content-Type` ต้องเป็น `application/json` ไม่งั้นได้ `415`

```bash
curl -X POST http://127.0.0.1:4000/api/run \
  -H 'Content-Type: application/json' \
  -d '{"test":"smoke","baseUrl":"http://localhost:8080","authorized":true}'
```

---

## GET `/api/config`

```json
{
  "tests": {
    "smoke": { "label": "Smoke", "note": "~30 วินาที · เช็กว่าระบบตอบได้" },
    "load":  { "label": "Load",  "note": "~5 นาที · ผู้ใช้คงที่" }
  },
  "options": {
    "smoke": [
      { "key": "VUS", "label": "จำนวนผู้ใช้ (VUs)", "type": "int", "default": 1, "min": 1, "max": 200 },
      { "key": "DURATION", "label": "ระยะเวลา", "type": "dur", "default": "30s", "ph": "เช่น 30s, 2m" }
    ],
    "payload": [ { "key": "MAX_BODY_MB", "type": "int", "default": 10, "min": 1, "max": 100 }, "..." ]
  },
  "defaultBaseUrl": "http://localhost:8080"
}
```
- `defaultBaseUrl` อ่านจาก `BASE_URL` ใน `config/config.js`
- `options[<test>]` = พารามิเตอร์ที่ปรับได้ของชุดนั้น (หน้าเว็บเอาไปสร้างช่องกรอก); `key` คือ env var ที่ไฟล์ test อ่าน, `type` = `int` (มี `min`/`max`) หรือ `dur` (เช่น `30s`,`5m`,`1h`), `default` = ค่าเริ่มต้นใน `config/config.js`

## POST `/api/run`

Request body:

| Field | Type | บังคับ | หมายเหตุ |
|-------|------|--------|----------|
| `test` | string | ✔ | ต้องเป็น key ใน `tests` ของ `/api/config` |
| `baseUrl` | string | ✔ | `http://` หรือ `https://` เท่านั้น |
| `authorized` | boolean | ✔ | ต้องเป็น `true` (ผู้ใช้ยืนยันว่าได้รับอนุญาต) |
| `authToken` | string | | ส่งเป็น `Bearer` token ให้ k6 |
| `options` | object | | พารามิเตอร์ของชุดนั้น เช่น `{ "VUS": "100", "DURATION": "2m" }` (ตาม `options` ใน `/api/config`) |

`options` ถูกตรวจฝั่ง server: รับเฉพาะ `key` ที่อยู่ในสเปกของชุดที่เลือก, ตรวจชนิด/ช่วง (int ต้องอยู่ใน `min`–`max`, dur ต้องตรง `^\d+(\.\d+)?(ms|s|m|h)$`) — ค่าที่ไม่ผ่านหรือ key แปลกปลอมจะถูกทิ้ง (ใช้ค่า default แทน) กันการยัด env เข้ากระบวนการ k6

Response:
- `200` → `{ "runId": "<uuid>" }`
- `400` → `{ "error": "<ข้อความภาษาไทย>" }` เมื่อชุดทดสอบไม่ถูกต้อง, URL ผิด หรือไม่ได้ยืนยันสิทธิ์
- `403` → `Host` หรือ `Origin` ไม่ใช่ server นี้ (ดู "การกันคำขอจากเว็บอื่น")
- `415` → ไม่ได้ส่ง `Content-Type: application/json`

การรันทำงานเบื้องหลัง เมื่อ k6 จบ server จะนำผลเข้า `reports/results.db` ทันที

## GET `/api/stream/<runId>` (Server-Sent Events)

`Content-Type: text/event-stream` ส่ง backlog ทั้งหมดก่อน แล้วตามด้วยบรรทัดใหม่แบบสด

```
data: {"type": "line", "line": "▶ เริ่ม smoke → http://localhost:8080"}

data: {"type": "done", "exitCode": 0}
```
- ส่ง `: keepalive` ทุก 20 วินาทีถ้าไม่มีบรรทัดใหม่
- ปิดสตรีมหลัง event `done` (`exitCode` ≠ 0 = มี threshold ไม่ผ่านหรือ k6 error; ผลยังถูกบันทึก)
- `404` ถ้าไม่รู้จัก `runId` (การรันเก็บในหน่วยความจำ หายเมื่อรีสตาร์ต server)

## GET `/api/dashboard`

ผลล่าสุดของแต่ละชุดทดสอบ (อ่านจาก DB)

```json
{
  "baseUrl": "https://staging.example.com",
  "worst": "yellow",
  "overall": "มีจุดควรเฝ้าระวัง",
  "generatedAt": "2026-11-24T07:01:49.123456+00:00",
  "tests": [
    {
      "type": "load",
      "label": "Load (โหลดปกติ)",
      "color": "green",
      "verdict": "ผ่าน SLA (error 0%, p95 552ms)",
      "ranAt": "2026-11-24T02:00:00+00:00",
      "metrics": { "...": "ดูหัวข้อ metrics ด้านล่าง" }
    }
  ]
}
```
`tests` เรียงตามลำดับ smoke → load → stress → spike → soak → security → fuzz
`baseUrl` คือเป้าหมายของการรันล่าสุด

## GET `/api/history`

```json
{
  "items": [
    {
      "file": "load-2026-11-24T02-00-00-000Z.json",
      "type": "load",
      "label": "Load (โหลดปกติ)",
      "baseUrl": "https://staging.example.com",
      "ranAt": "2026-11-24T02:00:00+00:00",
      "color": "green",
      "verdict": "ผ่าน SLA (error 0%, p95 552ms)",
      "metrics": { "...": "..." }
    }
  ]
}
```
ใหม่สุดก่อน ไม่เกิน 200 รายการ

---

## Object `metrics`

| Field | ความหมาย |
|-------|----------|
| `totalReqs` | จำนวน HTTP request ทั้งหมด |
| `rps` | request ต่อวินาที |
| `avg`, `p95`, `p99`, `max` | เวลาตอบสนอง (ms) — `null` ถ้าไม่มีข้อมูล |
| `failRate` | % request ที่ล้มเหลว |
| `maxVus` | virtual users สูงสุด |
| `checkRate`, `checkPass`, `checkFail` | % / จำนวน check ที่ผ่าน-ไม่ผ่าน |
| `securityFindings` | จุดน่าสงสัยที่พบ (ชุด security) |
| `bizErrors` | การตอบ 5xx/ล่ม/timeout ที่ไม่คาดหวัง (ชุด fuzz, payload, throughput) |
| `rateLimited` | จำนวนครั้งที่ระบบจำกัดอัตรา 429/503 (ชุด throughput, defense — ถือเป็นพฤติกรรมที่ดี) |
| `oversizeRejected` | จำนวนครั้งที่ระบบตอบ 413 ปฏิเสธ body ใหญ่ (ชุด payload) |
| `thrOk`, `thrTotal` | ผ่านทุก threshold ไหม / จำนวน threshold |

## การตัดสินสถานะ (`color`)

| ชุด | แดง | เหลือง | เขียว |
|-----|-----|--------|-------|
| security | `securityFindings > 0` | — | ไม่พบ |
| fuzz | — | `bizErrors > 0` | ไม่ crash |
| throughput | `bizErrors > 0` (error จริง) | โดน 429 (`rateLimited > 0`) | ไม่มี error |
| breakpoint | aborted + `bizErrors > 0` (crash) | aborted เพราะช้า (ไม่ crash) | ไต่ครบช่วงโดยไม่ abort |
| payload | `bizErrors > 0` (5xx/timeout) | — | ตอบ 413/รับได้โดยไม่ล่ม |
| defense | `bizErrors > 0` (5xx/timeout = เกราะไม่ไหว) | ไม่พบการจำกัดอัตราเลย | จำกัด 429/503 โดยไม่ล่ม |
| อื่นๆ | `failRate ≥ 5` | threshold ไม่ผ่าน หรือ `failRate ≥ 1` | นอกนั้น |

> ชุด `throughput` นับ 429 เป็นพฤติกรรมที่ดี จึงไม่คิดเป็น error (แดชบอร์ดใช้ `bizErrors` แทน `failRate`)
> ชุด `payload` ตอบ 413 เยอะทำให้ k6 `failRate` สูง แต่ไม่ใช่ความล้มเหลว — แดชบอร์ดจึงไม่โชว์ error rate

`worst` ใน `/api/dashboard` คือสีที่แย่ที่สุดในบรรดาผลล่าสุด
ตรรกะอยู่ที่ `verdict()` ใน `scripts/report_core.py`
