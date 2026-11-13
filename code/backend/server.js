
require("dotenv").config();

const mongoose = require("mongoose");
const http = require("http");

const { createApp } = require("./app");
const { createSocketServer } = require("./sockets");

const PORT = process.env.PORT || 5000;

const server = http.createServer(createApp());

createSocketServer(server);

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
