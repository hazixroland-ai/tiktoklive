# Bottle Overlay Service (MVP)

บริการเว็บสำหรับผู้ไลฟ์:
- สมัคร / ล็อกอิน
- สร้าง Overlay link สำหรับ TikTok LIVE Studio / OBS (ใส่เป็น Link Source / Browser Source)
- ระบบฟัง Gift (unofficial) -> ของ/แต้มไหลลง "ขวด" (progress) แบบ realtime
- ปุ่ม "ใช้ขวด" เพื่อเคลียร์ขวด + trigger event

> หมายเหตุ: การฟัง event Gift ใช้ไลบรารี reverse-engineered จึงอาจพังได้เมื่อ TikTok เปลี่ยนระบบ และควรทดสอบก่อนใช้งานจริง

## ติดตั้ง
```bash
npm install
cp .env.example .env
npm start
```

เปิดเว็บ: http://localhost:3000

## ใช้งาน
1) Register -> Login
2) Dashboard -> Create Streamer
3) กด Start Listening (ต้องกำลัง LIVE หรือบางครั้งต้องเริ่ม LIVE ก่อนให้ต่อได้)
4) เอา Overlay URL ไปใส่ใน TikTok LIVE Studio:
   - Add Source -> Link Source -> วาง URL

## โฮสติ้ง
- ต้องเป็นโฮสที่รัน Node.js ได้ และรองรับ WebSocket (ส่วนใหญ่ VPS/Cloud/Node hosting รองรับ)
- ถ้าเป็น shared hosting แบบ PHP-only จะรันตัว listener/ws ไม่ได้

## ปรับกติกา Gift -> ขวด
ดูใน `server.js` ส่วน `RULES` และ handler `conn.on("gift", ...)`
