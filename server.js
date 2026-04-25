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

const rooms = {};

io.on("connection", (socket) => {
  console.log("Un joueur connecté :", socket.id);

  socket.on("create_room", () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = [socket.id];
    socket.join(roomCode);
    socket.emit("room_created", roomCode);
  });

  socket.on("join_room", (code) => {
    if (rooms[code]) {
      rooms[code].push(socket.id);
      socket.join(code);
      io.to(code).emit("player_joined");
    } else {
      socket.emit("error_msg", "Room introuvable");
    }
  });

  socket.on("move", (data) => {
    socket.to(data.room).emit("move", data);
  });

  socket.on("action", (data) => {
    socket.to(data.room).emit("action", data);
  });

  socket.on("disconnect", () => {
    console.log("Un joueur déconnecté :", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Serveur lancé sur le port 3000");
});