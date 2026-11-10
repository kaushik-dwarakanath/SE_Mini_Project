const User = require("../models/User");
const { verifyToken } = require("../services/tokenService");
const logger = require("../utils/logger");

// Socket.IO middleware: runs on every connection attempt.
module.exports = async function socketAuth(socket, next) {
    const ip = socket.handshake.address;

    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            logger.warn("SOCKET_AUTH_FAILED", { reason: "missing token", ip });
            return next(new Error("Authentication required"));
        }

        const decoded = verifyToken(token);
        const user = await User.findById(decoded.userId).select("username");

        if (!user) {
            logger.warn("SOCKET_AUTH_FAILED", { reason: "user not found", ip });
            return next(new Error("User not found"));
        }

        socket.data.user = { id: user._id.toString(), username: user.username };
        socket.data.tokenExp = decoded.exp; // seconds since epoch, checked on each message

        return next();
    } catch (error) {
        logger.warn("SOCKET_AUTH_FAILED", { reason: error.name, ip });
        return next(new Error("Invalid authentication token"));
    }
};