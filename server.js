const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
const server = http.createServer(app);

// Socket.IO (WebSocket) – allow overlay page to connect
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));
app.get("/healthz", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME;

function startTikTok() {
  if (!TIKTOK_USERNAME) {
    console.error("❌ Missing env TIKTOK_USERNAME (set it on Fly with: fly secrets set TIKTOK_USERNAME=YOUR_ID)");
    return;
  }

  const tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME, {
    enableExtendedGiftInfo: true
  });

  const connect = async () => {
    try {
      await tiktokLive.connect();
      console.log("✅ Connected to TikTok Live:", TIKTOK_USERNAME);
    } catch (e) {
      console.error("⚠️ TikTok connect failed, retrying in 5s:", e?.message || e);
      setTimeout(connect, 5000);
    }
  };

  connect();

  tiktokLive.on("gift", (data) => {
    io.emit("newGift", {
      username: data.uniqueId,
      giftName: data.giftName,
      giftCount: data.repeatCount,
      giftId: data.giftId
    });
  });

  tiktokLive.on("disconnected", () => {
    console.log("🔌 Disconnected. Reconnecting...");
    setTimeout(connect, 3000);
  });
}

startTikTok();

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`Overlay URL: /overlay.html`);
});
