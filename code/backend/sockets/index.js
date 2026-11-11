const { Server } = require("socket.io");

const socketAuth = require("./socketAuth");
const { registerChatHandlers } = require("./chatHandlers");
const logger = require("../utils/logger");

const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

// Creates the Socket.IO server used by server.js. Kept separate from the
// startup code so integration tests can attach it to a test HTTP server
// without connecting to MongoDB or listening on the real port.
function createSocketServer(httpServer, { corsOrigins = DEFAULT_CORS_ORIGINS } = {}) {
    const io = new Server(httpServer, {
        cors: {
            origin: corsOrigins,
            methods: ["GET", "POST"]
        }
    });

    io.use(socketAuth);

    io.on("connection", (socket) => {
        logger.info("SOCKET_CONNECTED", {
            username: socket.data.user.username,
            socketId: socket.id
        });

        registerChatHandlers(io, socket);
    });

    return io;
}

module.exports = { createSocketServer, DEFAULT_CORS_ORIGINS };
