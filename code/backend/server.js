
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/User");

const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:5173",
            "http://localhost:3000"
        ],
        methods: ["GET", "POST"]
    }
});

const messages = [];

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Backend server is running"
    });
});

app.use("/", authRoutes);

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("Authentication required"));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId || decoded.sub;

        const user = await User.findById(userId).select("username");

        if (!user) {
            return next(new Error("User not found"));
        }

        socket.data.user = {
            id: user._id.toString(),
            username: user.username
        };

        next();
    } catch (error) {
        next(new Error("Invalid authentication token"));
    }
});


io.on("connection", (socket) => {
    console.log(
        "Client connected:",
        socket.data.user.username,
        socket.id
    );

    // Send previous messages to the newly connected client
    socket.emit("chat_history", messages);

    socket.on("message", (data) => {
        if (
            !data ||
            typeof data.text !== "string" ||
            !data.text.trim()
        ) {
            socket.emit("message_error", {
                message: "Message text is required"
            });
            return;
        }

        const message = {
            text: data.text.trim(),
            senderId: socket.data.user.id,
            username: socket.data.user.username,
            timestamp: new Date().toISOString()
        };

        // Store the message on the server
        messages.push(message);

        console.log("Message received:", message);

        // Send the new message to all connected clients
        io.emit("new_message", message);
    });

    socket.on("disconnect", (reason) => {
        console.log(
            "Client disconnected:",
            socket.id,
            "Reason:",
            reason
        );
    });
});

const startServer = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is not configured");
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connected successfully");

        await mongoose.connection.db.admin().ping();

        await mongoose.connection.db.collection("users").createIndex(
            { username: 1 },
            { unique: true }
        );

        await mongoose.connection.db.collection("users").createIndex(
            { email: 1 },
            { unique: true }
        );

        server.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
};

startServer();
