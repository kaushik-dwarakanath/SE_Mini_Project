
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const http = require("http");
const { Server } = require("socket.io");

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

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
};

startServer();
