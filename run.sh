#!/usr/bin/env bash
# run.sh — เปิด web app (เวอร์ชัน Python) อย่างสะดวก
#   ./run.sh            เปิดที่พอร์ต 4000
#   PORT=5000 ./run.sh  เปลี่ยนพอร์ต
cd "$(dirname "$0")"
exec python3 server.py
