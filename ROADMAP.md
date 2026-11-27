# Roadmap

แผนงานที่เหลือของ rx_k6 เรียงตามลำดับที่ควรทำ — ติ๊ก `[x]` เมื่อเสร็จ
งานที่เสร็จแล้วย้ายไปบันทึกใน [CHANGELOG.md](CHANGELOG.md)

> อัปเดตล่าสุด: 2026-11-27

## ขั้นที่ 1 — ปิดงานค้าง

- [x] **Merge `fix/review-followups`** — แก้ช่องว่าง attribute ในแดชบอร์ด + เอกสาร Host/Origin guard; เทสต์ทั้งหมดผ่านก่อน merge
- [x] **ลบ branch ที่ merge แล้ว** — `test/server-py` และ `fix/review-followups` (ในเครื่อง + GitHub)
- [x] **ออกเวอร์ชันใน CHANGELOG** — `[Unreleased]` → `## 2026-11-27` (รวมรายการของ `fix/review-followups` แล้ว)
- [x] **git tag** — ติด `2026-11-27` (annotated) ใช้ชื่อตามหัวข้อวันที่ใน CHANGELOG
- [x] **แก้เวอร์ชัน Node ใน CONTRIBUTING.md** — เปลี่ยนเป็น Node 22+ ให้ตรงกับ CI

## ขั้นที่ 2 — เตรียมเปิด repo เป็น public

ตรวจแล้ว (2026-11-27):

- [x] ไม่มี secret / token / API key ในประวัติ git ทุก commit
- [x] ไม่มี URL หรือ host ภายในองค์กร — มีแค่ `localhost`, `staging.example.com`, `example.test`
- [x] ไม่เคย commit `reports/*.json`, `*.db`, `.claude/settings.local.json` และอยู่ใน `.gitignore`
- [x] มีคำเตือนการใช้งานเฉพาะระบบที่ได้รับอนุญาตใน README และ [SECURITY.md](SECURITY.md)

ต้องตัดสินใจ / ทำก่อนเปิด:

- [x] **อีเมลส่วนตัวในประวัติ git** — เลือกทาง A: rewrite ทุก commit ให้ใช้อีเมล noreply ของ GitHub
      แล้วย้ายมา repo ใหม่ `rx8s/rx-k6`; repo เดิม (`rx8s/rxk6tools`) เก็บเป็น private
      ประวัติ PR เดิมไม่ได้ตามมา จึงตัดเลข PR ออกจากหัวข้อ commit และเอกสารแล้ว
- [x] **เพิ่ม LICENSE** — เลือก MIT (`LICENSE`, อ้างอิงใน README และ `package.json`)
- [x] ตัดเลข PR ที่ชี้ไป repo เดิมออกจาก CHANGELOG / ROADMAP / หัวข้อ commit
- [x] **เปิด `rx8s/rx-k6` เป็น public** — เปิดแล้ว 2026-11-27 พร้อมคำอธิบาย repo ใหม่

## ขั้นที่ 3 — คุณภาพโค้ด

- [x] **เวอร์ชัน Node** — ลบทิ้ง ใช้ Python อย่างเดียว (`npm run web` / `npm run report` เรียก Python แทน)
- [x] **เทสต์ `scripts/make_report.py`** — `scripts/test_make_report.py` รันใน CI
      (เจอและแก้บั๊กข้อความ `p95 Nonems` ใน `verdict()` ระหว่างเขียนเทสต์)

## เสร็จแล้ว (2026-11-27)

- [x] CI บน GitHub Actions — `py_compile`, self-test, `node --check`, `k6 inspect`
- [x] เทสต์ `server.py` 16 ข้อ รันใน CI + แก้บั๊ก request ผิดรูปแบบทำ handler พัง
- [x] กัน CSRF / DNS rebinding ใน `/api/run`
- [x] ลบ worktree และ branch เก่าที่ merge แล้ว
