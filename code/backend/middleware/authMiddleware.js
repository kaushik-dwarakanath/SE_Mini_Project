const { verifyToken } = require("../services/tokenService");
const logger = require("../utils/logger");

module.exports = function authMiddleware(req, res, next) {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
        logger.warn("REST_AUTH_FAILED", { reason: "missing token", ip: req.ip, path: req.originalUrl });
        return res.status(401).json({ message: "Authentication required" });
    }

    try {
        const decoded = verifyToken(token);
        req.user = { id: decoded.userId };
        return next();
    } catch (error) {
        logger.warn("REST_AUTH_FAILED", { reason: error.name, ip: req.ip, path: req.originalUrl });
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};