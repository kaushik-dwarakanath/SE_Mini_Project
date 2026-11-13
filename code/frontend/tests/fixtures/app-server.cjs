// Production REST routes, JWT verification and Socket.IO handlers with only
// database access replaced by deterministic in-memory records. No MongoDB.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "acceptance-tests-only-never-use-in-production";
const http = require("node:http");
const { createRequire } = require("node:module");
const backendRequire = createRequire(require.resolve("../../../backend/package.json"));
const express = backendRequire("express");
const bcrypt = backendRequire("bcryptjs");
const User = backendRequire("./models/User");
const messages = backendRequire("./services/messageService");
const users = ["Alice", "Bob"].map((username, index) => ({
  _id: String(index + 1).padStart(24, "0"), username,
  email: `${username.toLowerCase()}@example.com`,
  password: bcrypt.hashSync("password123", 4),
}));
User.findById = (id) => ({ select: () => {
  const user = users.find((u) => u._id === id);
  const promise = Promise.resolve(user);
  promise.lean = () => Promise.resolve(user);
  return promise;
} });
User.findOne = ({ $or }) => ({ select: async () => users.find((u) =>
  $or.some((criteria) => Object.entries(criteria).every(([key, value]) => u[key] === value))) });
messages.getHistory = async () => [];
messages.saveMessage = async ({ senderId, username, roomId, content }) => ({
  id: require("node:crypto").randomUUID(), senderId, username, roomId,
  text: content, timestamp: new Date().toISOString(),
});
const app = express();
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ status: "OK" }));
app.use(backendRequire("./routes/auth"));
const server = http.createServer(app);
const { createSocketServer } = backendRequire("./sockets");
const io = createSocketServer(server);
app.post("/api/test/drop/:username", (req, res) => {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user.username === req.params.username) socket.conn.close();
  }
  res.json({});
});
app.get("/api/test/connections", (_req, res) => res.json({ count: io.sockets.sockets.size }));
server.listen(5000, "127.0.0.1");
