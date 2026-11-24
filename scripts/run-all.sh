#!/usr/bin/env bash
# ============================================================================
# run-all.sh — รันทุกชุดทดสอบตามลำดับ แล้วสร้างรายงานผู้บริหาร
#   ใช้งาน:  BASE_URL=https://staging.example.com ./scripts/run-all.sh
#   ข้ามชุดยาวได้:  SKIP_SOAK=1 ./scripts/run-all.sh
# ============================================================================
set -u
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:8080}"
export BASE_URL

echo "=============================================="
echo " เป้าหมาย: $BASE_URL"
echo " ⚠️  ทดสอบเฉพาะระบบที่คุณได้รับอนุญาตเท่านั้น"
echo "=============================================="
read -r -p "ยืนยันว่าได้รับอนุญาตให้ทดสอบเป้าหมายนี้? (yes/no): " ok
[ "$ok" = "yes" ] || { echo "ยกเลิก"; exit 1; }

mkdir -p reports

run() {
  echo ""; echo "▶  $1 ..."
  k6 run -e TEST_TYPE="$1" "tests/$1.js" || echo "   (ชุด $1 จบแบบมี threshold ไม่ผ่าน — บันทึกผลไว้แล้ว)"
}

run smoke      # ต้องผ่านก่อน ถึงจะมีความหมายรันต่อ
run load
run stress
run spike
run throughput
[ "${SKIP_BREAKPOINT:-0}" = "1" ] || run breakpoint   # อาจนานถึง ~15 นาที (หยุดเองเมื่อเจอจุดพัง)
[ "${SKIP_SOAK:-0}" = "1" ] || run soak
run security
run fuzz
run payload
run defense

echo ""; echo "▶  บันทึกผลลง reports/results.db + สร้างรายงานผู้บริหาร ..."
python3 scripts/make_report.py
echo ""; echo "เปิดรายงาน:  open reports/executive-report.html"
