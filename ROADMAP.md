# Roadmap

แผนงานที่เหลือของ rx_k6 เรียงตามลำดับที่ควรทำ — ติ๊ก `[x]` เมื่อเสร็จ
งานที่เสร็จแล้วย้ายไปบันทึกใน [CHANGELOG.md](CHANGELOG.md)

> อัปเดตล่าสุด: 2026-11-27

## ขั้นที่ 1 — ปิดงานค้าง

- [x] **Merge PR #2** (`fix/review-followups`) — squash เป็น `76264ad`; เทสต์ทั้งหมดผ่านก่อน merge
- [x] **ลบ branch ที่ merge แล้ว** — `test/server-py` และ `fix/review-followups` (ในเครื่อง + GitHub)
- [x] **ออกเวอร์ชันใน CHANGELOG** — `[Unreleased]` → `## 2026-11-27` (รวมรายการของ #2 แล้ว)
- [ ] **git tag** — ยังไม่ติด: repo ยังไม่มีระบบเลขเวอร์ชัน ต้องเลือกก่อน
      (เช่น `v0.1.0` แบบ semver หรือ `2026-11-27` ตามหัวข้อ CHANGELOG)
- [x] **แก้เวอร์ชัน Node ใน CONTRIBUTING.md** — เปลี่ยนเป็น Node 22+ ให้ตรงกับ CI

## ขั้นที่ 2 — เตรียมเปิด repo เป็น public

ตรวจแล้ว (2026-11-27):

- [x] ไม่มี secret / token / API key ในประวัติ git ทุก commit
- [x] ไม่มี URL หรือ host ภายในองค์กร — มีแค่ `localhost`, `staging.example.com`, `example.test`
- [x] ไม่เคย commit `reports/*.json`, `*.db`, `.claude/settings.local.json` และอยู่ใน `.gitignore`
- [x] มีคำเตือนการใช้งานเฉพาะระบบที่ได้รับอนุญาตใน README และ [SECURITY.md](SECURITY.md)

ต้องตัดสินใจ / ทำก่อนเปิด:

- [ ] **อีเมลส่วนตัวในประวัติ git** — 10 commit แรกบน master (`44c892a` … `c255c2f`)
      ใช้อีเมลส่วนตัว เปิด public แล้วทุกคนเห็นผ่าน `git log`
      (`refs/pull/*` ของ GitHub ลบเองไม่ได้ จึงแค่ rewrite + force-push ยังไม่หายสนิท) เลือกหนึ่งทาง:
  - **A. (แนะนำ)** rewrite ประวัติให้ใช้อีเมล noreply แล้ว push ไป **repo ใหม่** ที่ว่าง
    เก็บ repo เดิมเป็น private — หายสนิท แต่หน้า PR เดิมไม่ตามมา
  - **B.** ยอมรับ — เปิด repo เดิมเป็น public ทั้งแบบนี้
  - **C.** rewrite + force-push repo เดิม แล้วขอ GitHub Support ลบ PR refs
- [ ] **เพิ่ม LICENSE** — ไม่มี license = คนอื่นดูโค้ดได้แต่ไม่มีสิทธิ์ใช้/แก้ตามกฎหมาย
      ตัวเลือก: MIT · Apache-2.0 (มีข้อคุ้มครองสิทธิบัตร) · ไม่ใส่ (ให้ดูอย่างเดียว)
- [ ] ถ้าเลือกทาง A: อัปเดตลิงก์ PR (#1, #3) ใน CHANGELOG/commit ที่ชี้ไป repo เดิม

## ขั้นที่ 3 — คุณภาพโค้ด

- [ ] **ตัดสินใจเรื่องเวอร์ชัน Node** (`server.js`, `scripts/report-core.js`, `scripts/make-report.js`)
      ต้องแก้ตามเวอร์ชัน Python ทุกครั้ง, ไม่มีเทสต์, และเคยมีบั๊กเฉพาะตัว
      (body `null` ทำ process ล่ม — แก้แล้ว) ทางเลือก:
  - ลบทิ้ง ใช้ Python อย่างเดียว (เว็บ `web/` ใช้ต่อได้เลย) — แก้ CLAUDE.md, README, `package.json` ตาม
  - เก็บไว้ แต่เพิ่มเทสต์แบบเดียวกับ `scripts/test_server.py` และรันใน CI
- [ ] เพิ่มเทสต์ให้ `scripts/make_report.py` (ตอนนี้ CI ตรวจแค่ว่า compile ผ่าน)

## เสร็จแล้ว (2026-11-27)

- [x] CI บน GitHub Actions — `py_compile`, self-test, `node --check`, `k6 inspect` (PR #3)
- [x] เทสต์ `server.py` 16 ข้อ รันใน CI + แก้บั๊ก request ผิดรูปแบบทำ handler พัง
- [x] กัน CSRF / DNS rebinding ใน `/api/run` (PR #1)
- [x] ลบ worktree และ branch เก่าที่ merge แล้ว
