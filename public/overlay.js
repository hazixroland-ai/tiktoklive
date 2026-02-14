const pathParts = location.pathname.split("/");
const streamerId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
const qs = new URLSearchParams(location.search);
const token = qs.get("token");

const titleEl = document.getElementById("title");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const fillEl = document.getElementById("fill");
const toastEl = document.getElementById("toast");
const capLabel = document.getElementById("capLabel");
const useBtn = document.getElementById("useBottle");
const dropEl = document.getElementById("drop");

let bottle = { current: 0, capacity: 100 };

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

function setBottle(b) {
  bottle = b || bottle;
  const pct = Math.max(0, Math.min(1, (bottle.current || 0) / (bottle.capacity || 100)));
  fillEl.style.height = `${pct * 100}%`;
  progressEl.textContent = `${bottle.current} / ${bottle.capacity}`;
}

function animateDrop() {
  dropEl.classList.remove("animate");
  void dropEl.offsetWidth;
  dropEl.classList.add("animate");
}

async function fetchState() {
  const res = await fetch(`/api/overlay/${encodeURIComponent(streamerId)}/state?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to fetch state");

  titleEl.textContent = data.displayName ? `Bottle: ${data.displayName}` : "Bottle Overlay";
  capLabel.textContent = data.displayName || "ขวด";
  statusEl.textContent = `Status: ${data.connected ? "connected" : "disconnected"} @${data.uniqueId || "-"}`;
  setBottle(data.bottle);
}

async function useBottle() {
  const res = await fetch(`/api/overlay/${encodeURIComponent(streamerId)}/bottle/use?token=${encodeURIComponent(token)}`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) return showToast(`Use failed: ${data?.error || "error"}`);
  showToast(`เทขวดแล้ว (+${data.usedAmount})`);
}

function connectWS() {
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${wsProto}://${location.host}/ws?streamerId=${encodeURIComponent(streamerId)}&token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => showToast("Overlay connected");
  ws.onclose = () => setTimeout(connectWS, 1000);
  ws.onerror = () => ws.close();

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "hello") {
      titleEl.textContent = msg.displayName ? `Bottle: ${msg.displayName}` : "Bottle Overlay";
      capLabel.textContent = msg.displayName || "ขวด";
      statusEl.textContent = `Status: ${msg.connected ? "connected" : "disconnected"} @${msg.uniqueId || "-"}`;
      setBottle(msg.bottle);
      return;
    }

    if (msg.type === "status") {
      statusEl.textContent = `Status: ${msg.connected ? "connected" : "disconnected"} @${msg.uniqueId || "-"}`;
      if (msg.error) showToast(`Error: ${msg.error}`);
      return;
    }

    if (msg.type === "gift_into_bottle") {
      setBottle(msg.bottle);
      animateDrop();
      const g = msg.gift;
      showToast(`@${g.senderName} ${g.giftName} +${g.add}`);
      return;
    }

    if (msg.type === "bottle_full") {
      showToast("ขวดเต็มแล้ว!");
      return;
    }

    if (msg.type === "bottle_reset") {
      setBottle(msg.bottle);
      showToast("รีเซ็ตขวด");
      return;
    }

    if (msg.type === "bottle_used") {
      // optional: show used amount
      return;
    }
  };
}

useBtn.addEventListener("click", () => useBottle());

fetchState().catch(err => showToast(err.message));
connectWS();
