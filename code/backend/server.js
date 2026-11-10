
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const messageRoutes = require("./routes/messages");
const socketAuth = require("./sockets/socketAuth");
const { registerChatHandlers } = require("./sockets/chatHandlers");
const logger = require("./utils/logger");

const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "http://localhost:3000"],
        methods: ["GET", "POST"]
    }
});

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Backend server is running"
    });
});

app.use("/", authRoutes);
app.use("/api/messages", messageRoutes);

io.use(socketAuth);

io.on("connection", (socket) => {
    logger.info("SOCKET_CONNECTED", {
        username: socket.data.user.username,
        socketId: socket.id
    });

    registerChatHandlers(io, socket);
});

const startServer = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is not configured");
        }

        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not configured");
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connected successfully");

        server.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
};

startServer();
