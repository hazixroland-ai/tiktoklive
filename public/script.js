const socket = io();
const items = document.getElementById("items");
const water = document.getElementById("water");

let level = 20; // water level (%)

function bumpWater(by) {
  level = Math.min(95, level + by);
  water.style.height = `${level}%`;
}

socket.on("connect", () => {
  // You can show a small debug in console if needed
  // console.log("Overlay connected");
});

socket.on("newGift", (data) => {
  const el = document.createElement("div");
  el.className = "item";
  el.textContent = `${data.username} 🎁 ${data.giftName} x${data.giftCount}`;

  // random horizontal variation
  el.style.left = `${38 + Math.random()*24}%`;

  items.appendChild(el);

  const inc = Math.min(8, 1 + (data.giftCount || 1));
  bumpWater(inc);

  setTimeout(() => el.remove(), 4500);
});
