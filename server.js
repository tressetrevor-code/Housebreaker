const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

const rooms = new Map(); // roomCode -> { players: Map<socketId, state> }
const socketToRoom = new Map(); // socketId -> roomCode

function makeRoomCode() {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function getRoomPlayerCount(roomCode) {
  const room = rooms.get(roomCode);
  return room ? room.players.size : 0;
}

function emitRoomUpdate(roomCode) {
  io.to(roomCode).emit("room_update", { roomCode, playersCount: getRoomPlayerCount(roomCode) });
}

function leaveCurrentRoom(socket) {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  socketToRoom.delete(socket.id);
  socket.leave(roomCode);

  if (!room) return;
  room.players.delete(socket.id);
  socket.to(roomCode).emit("player_left", { playerId: socket.id, roomCode });

  if (room.players.size <= 0) rooms.delete(roomCode);
  else emitRoomUpdate(roomCode);
}

io.on("connection", (socket) => {
  console.log("Un joueur connecte:", socket.id);

  socket.on("create_room", (_, ack) => {
    leaveCurrentRoom(socket);

    const roomCode = makeRoomCode();
    const room = { players: new Map() };
    room.players.set(socket.id, null);
    rooms.set(roomCode, room);

    socketToRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    if (typeof ack === "function") {
      ack({ ok: true, roomCode, playerId: socket.id, players: [] });
    }
    socket.emit("room_players_snapshot", { roomCode, players: [] });
    emitRoomUpdate(roomCode);
  });

  socket.on("join_room", (payload, ack) => {
    const roomCode = String(payload && payload.roomCode ? payload.roomCode : payload || "")
      .trim()
      .toUpperCase();

    if (!roomCode || !rooms.has(roomCode)) {
      if (typeof ack === "function") ack({ ok: false, error: "Room introuvable" });
      else socket.emit("error_msg", "Room introuvable");
      return;
    }

    leaveCurrentRoom(socket);
    const room = rooms.get(roomCode);

    const snapshot = [];
    for (const [playerId, state] of room.players.entries()) {
      if (playerId === socket.id) continue;
      snapshot.push({ playerId, state });
    }

    room.players.set(socket.id, null);
    socketToRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    if (typeof ack === "function") {
      ack({ ok: true, roomCode, playerId: socket.id, players: snapshot });
    }

    socket.emit("room_players_snapshot", { roomCode, players: snapshot });
    socket.to(roomCode).emit("player_joined", { playerId: socket.id, roomCode });
    emitRoomUpdate(roomCode);
  });

  socket.on("player_state", (data) => {
    const roomCode = String(
      data && data.roomCode ? data.roomCode : socketToRoom.get(socket.id) || ""
    ).toUpperCase();

    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;

    const state = data && data.state ? data.state : null;
    room.players.set(socket.id, state);
    socket.to(roomCode).emit("player_state", { playerId: socket.id, roomCode, state });
  });

  // Compat with old clients
  socket.on("move", (data) => {
    const roomCode = String(
      data && data.roomCode ? data.roomCode : data && data.room ? data.room : socketToRoom.get(socket.id) || ""
    ).toUpperCase();
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;

    const state = data && data.state ? data.state : data;
    room.players.set(socket.id, state);
    socket.to(roomCode).emit("move", { playerId: socket.id, roomCode, state });
  });

  socket.on("action", (data) => {
    const roomCode = String(
      data && data.roomCode ? data.roomCode : data && data.room ? data.room : socketToRoom.get(socket.id) || ""
    ).toUpperCase();
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;

    socket.to(roomCode).emit("action", { ...data, playerId: socket.id, roomCode });
  });

  socket.on("chat_message", (data) => {
    const roomCode = String(
      data && data.roomCode ? data.roomCode : socketToRoom.get(socket.id) || ""
    ).toUpperCase();
    const message = String(data && data.message ? data.message : "").trim();
    if (!roomCode || !message) return;
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;

    io.to(roomCode).emit("chat_message", { roomCode, playerId: socket.id, message: message.slice(0, 140) });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
    console.log("Un joueur deconnecte:", socket.id);
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.get("/", (_, res) => {
  res.send("Housebreaker socket server running.");
});

server.listen(PORT, () => {
  console.log("Serveur lance sur le port", PORT);
});