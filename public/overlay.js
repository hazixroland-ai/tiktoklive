// Reads slug from data attribute and key from query string (?k=...)
const slug = document.documentElement.getAttribute("data-slug");
const params = new URLSearchParams(location.search);
const key = params.get("k") || "";

const items = document.getElementById("items");
const water = document.getElementById("water");

let level = 20; // %

function bumpWater(by) {
  level = Math.min(95, level + by);
  water.style.height = `${level}%`;
}

const socket = io({
  auth: { slug, key }
});

socket.on("connect_error", (err) => {
  // If key wrong, overlay will not work
  console.log("Socket auth failed:", err.message);
});

socket.on("newGift", (data) => {
  const el = document.createElement("div");
  el.className = "item";
  el.textContent = `${data.username} 🎁 ${data.giftName} x${data.giftCount}`;
  el.style.left = `${38 + Math.random()*24}%`;
  items.appendChild(el);

  const inc = Math.min(8, 1 + (data.giftCount || 1));
  bumpWater(inc);

  setTimeout(() => el.remove(), 4500);
});
