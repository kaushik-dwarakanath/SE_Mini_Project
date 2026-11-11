const express = require("express");

const authRoutes = require("./routes/auth");
const messageRoutes = require("./routes/messages");

// Builds the Express application (REST routes only). server.js attaches it to
// the HTTP server together with Socket.IO; tests can use it the same way.
function createApp() {
    const app = express();

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.status(200).json({
            status: "OK",
            message: "Backend server is running"
        });
    });

    app.use("/", authRoutes);
    app.use("/api/messages", messageRoutes);

    return app;
}

module.exports = { createApp };
