# TikTok Live Gift Bottle Overlay (SaaS / สมาชิก)

ระบบนี้ทำให้ "ผู้ไลฟ์" สมัครสมาชิก → ใส่ TikTok username → ได้ลิงก์ Overlay ของตัวเองไปใส่ TikTok Live Studio ได้ทันที

## URLs สำคัญ
- สมัคร: `/signup`
- ล็อกอิน: `/login`
- แดชบอร์ด: `/dashboard`
- Overlay: `/o/<slug>?k=<overlay_key>`
- Health: `/healthz`

## Local Run (ต้องมี Postgres)
1) สร้าง DB แล้วตั้ง `.env`
```bash
cp .env.example .env
npm i
node migrate.js
npm start
```
เปิด `http://localhost:3000`

## Deploy บน Fly.io + Fly Postgres (แนะนำ)
### 1) สร้างแอป
```bash
fly launch
```

### 2) สร้าง Postgres แล้ว attach
```bash
fly postgres create
fly postgres attach -a <APP_NAME> <PG_APP_NAME>
```
(Fly จะใส่ `DATABASE_URL` ให้ใน secrets)

### 3) ตั้งค่า secrets
```bash
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)" -a <APP_NAME>
fly secrets set BASE_URL="https://<APP_NAME>.fly.dev" -a <APP_NAME>
# เปิด/ปิดระบบเทส (ถ้าจะปิดตอนใช้งานจริง)
fly secrets set ENABLE_TEST=true -a <APP_NAME>
```

### 4) รัน migration บน Fly
```bash
fly ssh console -a <APP_NAME> -C "node migrate.js"
```

### 5) Deploy
```bash
fly deploy -a <APP_NAME>
```

## วิธีใช้งาน (ผู้ไลฟ์)
1) สมัคร / ล็อกอิน
2) ตั้งค่า Slug + TikTok Username ใน Dashboard
3) กด Start (ให้ระบบเริ่มเชื่อม TikTok Live)
4) คัดลอก Overlay URL ไปใส่ TikTok Live Studio (Browser Source)

## หมายเหตุ
- ระบบนี้ “ฟัง” ของขวัญที่คนดูส่งให้ผู้ไลฟ์ แล้วแสดงผลใน overlay
- ต้อง Live จริง และมีคนส่งของขวัญจริงจึงจะเห็น event (นอกจากใช้ test gift)
