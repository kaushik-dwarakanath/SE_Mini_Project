// Real Socket.IO transport with test-only authentication; no MongoDB required.
const http = require("node:http");
const { createRequire } = require("node:module");
const backendRequire = createRequire(require.resolve("../../../backend/package.json"));
const { Server } = backendRequire("socket.io");

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost:5000");
  response.setHeader("Content-Type", "application/json");

  if (request.method === "GET" && url.pathname === "/api/health") {
    response.end(JSON.stringify({ status: "OK" }));
    return;
  }

  const sockets = [...io.sockets.sockets.values()].filter(
    (socket) => socket.handshake.auth.token === url.searchParams.get("token")
  );

  if (request.method === "GET" && url.pathname === "/api/test/connections") {
    response.end(JSON.stringify({ count: sockets.length }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test/drop") {
    for (const socket of sockets) socket.conn.close();
    response.end("{}");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test/disconnect") {
    for (const socket of sockets) socket.disconnect(true);
    response.end("{}");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test/messages") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      for (const message of JSON.parse(body)) {
        for (const socket of sockets) socket.emit("new_message", message);
      }
      response.end("{}");
    });
    return;
  }

  response.writeHead(404);
  response.end("{}");
});

const io = new Server(server);
io.use((socket, next) => {
  // Match the backend's auth.token handshake contract. Each test has its own
  // token so connection counts and disconnects remain isolated in parallel.
  if (socket.handshake.auth.token?.startsWith("ui-test-")) {
    next();
  } else {
    next(new Error("Invalid authentication token"));
  }
});

server.listen(5000, "127.0.0.1");
