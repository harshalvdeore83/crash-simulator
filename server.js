const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let players = {};
let bets = {};
let round = 1;
let running = false;

function generateSeed() {
  return crypto.randomBytes(32).toString("hex");
}

function hashSeed(seed) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function getCrash(serverSeed, clientSeed, nonce) {
  const hmac = crypto
    .createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest("hex");

  const hex = hmac.substring(0, 13);
  const int = parseInt(hex, 16);
  const crash = Math.max(1, (100 / (1 - int / Math.pow(2, 52)))) / 100;

  return crash;
}

const clientSeed = "public-demo-seed";

function startRound() {
  running = true;
  bets = {};

  const serverSeed = generateSeed();
  const commitment = hashSeed(serverSeed);
  const crashPoint = getCrash(serverSeed, clientSeed, round);

  io.emit("round_start", { round, commitment });

  let multiplier = 1;

  const interval = setInterval(() => {
    multiplier += 0.02;

    if (multiplier >= crashPoint) {
      clearInterval(interval);
      running = false;

      io.emit("round_crash", {
        crash: crashPoint.toFixed(2),
        serverSeed,
        clientSeed,
        nonce: round,
      });

      round++;
      setTimeout(startRound, 4000);
      return;
    }

    io.emit("tick", multiplier.toFixed(2));
  }, 100);
}

io.on("connection", socket => {
  players[socket.id] = {
    name: "Player_" + socket.id.slice(0, 4),
    balance: 1000,
  };

  socket.emit("players", players);

  socket.on("bet", amount => {
    const p = players[socket.id];
    if (!running && p.balance >= amount) {
      p.balance -= amount;
      bets[socket.id] = { amount, cashed: false };
      io.emit("players", players);
    }
  });

  socket.on("cashout", multiplier => {
    const bet = bets[socket.id];
    if (bet && !bet.cashed && running) {
      const win = bet.amount * multiplier;
      players[socket.id].balance += win;
      bet.cashed = true;
      io.emit("players", players);
    }
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    delete bets[socket.id];
    io.emit("players", players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
  startRound();
});

