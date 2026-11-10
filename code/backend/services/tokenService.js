const jwt = require("jsonwebtoken");

const getSecret = () => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
    }
    return process.env.JWT_SECRET;
};

const signToken = (userId) =>
    jwt.sign({ userId: String(userId) }, getSecret(), { expiresIn: "1h" });

// Throws on invalid or expired tokens (TokenExpiredError / JsonWebTokenError).
const verifyToken = (token) => jwt.verify(token, getSecret());

module.exports = { signToken, verifyToken };