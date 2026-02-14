# TikTok Gift Bottle Overlay (Fly.io)

## 1) Run locally (optional)
```bash
npm install
TIKTOK_USERNAME=YOUR_TIKTOK_ID npm start
# open http://localhost:3000/overlay.html
```

## 2) Deploy to Fly.io
### Install + login
```bash
fly auth login
```

### Launch (creates app + fly.toml on your machine)
From this folder:
```bash
fly launch
```
- Choose region (recommend: sin)
- When asked to deploy now: Yes

### Set TikTok username (secret)
```bash
fly secrets set TIKTOK_USERNAME=YOUR_TIKTOK_ID
```

### Deploy
```bash
fly deploy
```

## 3) Use in TikTok Live Studio
Browser Source URL:
```
https://YOUR_APP_NAME.fly.dev/overlay.html
```

## Notes
- This app keeps at least 1 machine running (`min_machines_running = 1`) to avoid sleeping.
- If you want different usernames per overlay URL, tell me — I can change it to `/?u=username`.
