require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Message = require("./models/Message");

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

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Backend server is running"
    });
});

app.use("/", authRoutes);

// Socket.IO authentication
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

// Handle chat connections and messages
io.on("connection", async (socket) => {
    console.log(
        "Client connected:",
        socket.data.user.username,
        socket.id
    );

    // Load previous messages from MongoDB
    try {
        const history = await Message.find({ roomId: "general" })
            .populate("senderId", "username")
            .sort({ createdAt: 1 })
            .limit(100)
            .lean();

        const formattedHistory = history.map((msg) => ({
            id: msg._id.toString(),
            text: msg.content,
            username: msg.senderId?.username || "User",
            senderId: msg.senderId?._id?.toString() || "",
            timestamp: msg.createdAt
        }));

        socket.emit("chat_history", formattedHistory);
    } catch (error) {
        console.error("Failed to load chat history:", error.message);

        socket.emit("message_error", {
            message: "Unable to load chat history"
        });
    }

    // Receive and save new messages
    socket.on("message", async (data) => {
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

        try {
            const savedMessage = await Message.create({
                senderId: socket.data.user.id,
                roomId: "general",
                content: data.text.trim()
            });

            const message = {
                id: savedMessage._id.toString(),
                text: savedMessage.content,
                username: socket.data.user.username,
                senderId: savedMessage.senderId.toString(),
                timestamp: savedMessage.createdAt
            };

            // Broadcast only after successful database save
            io.emit("new_message", message);

            console.log("Message saved:", message.id);
        } catch (error) {
            console.error("Message save failed:", error.message);

            socket.emit("message_error", {
                message: "Message could not be saved. Please try again."
            });
        }
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

// Start server after MongoDB connection
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