
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signToken } = require("../services/tokenService");
const authMiddleware = require("../middleware/authMiddleware");
const logger = require("../utils/logger");

const router = express.Router();

// Register a new user
router.post("/register", async (req, res) => {
    try {
        let { username, email, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Username, email and password are required"
            });
        }

        username = username.trim();
        email = email.trim().toLowerCase();

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters long"
            });
        }

        const existingUser = await User.findOne({
            $or: [{ username }, { email }]
        });

        if (existingUser) {
            return res.status(409).json({
                message: "Username or email already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await User.create({
            username,
            email,
            password: hashedPassword
        });

        return res.status(201).json({
            message: "Registration successful",
            token: signToken(user._id),
            user: {
                userId: user._id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "Username or email already exists"
            });
        }

        if (error.name === "ValidationError") {
            return res.status(400).json({
                message: "Invalid registration details"
            });
        }

        console.error("Registration error:", error.message);

        return res.status(500).json({
            message: "Internal server error"
        });
    }
});

// Log in using username or email and password.
router.post("/login", async (req, res) => {
    try {
        const { identifier, username, email, password } = req.body;

        const loginIdentifier = identifier ?? username ?? email;

        if (
            typeof loginIdentifier !== "string" ||
            !loginIdentifier.trim() ||
            typeof password !== "string" ||
            !password
        ) {
            return res.status(400).json({
                message: "Username/email and password are required"
            });
        }

        const value = loginIdentifier.trim();

        const user = await User.findOne({
            $or: [
                { username: value },
                { email: value.toLowerCase() }
            ]
        }).select("+password");

        if (!user) {
            logger.warn("LOGIN_FAILED", {
                reason: "unknown user",
                identifier: value,
                ip: req.ip
            });

            return res.status(401).json({
                message: "Invalid username/email or password"
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatches) {
            logger.warn("LOGIN_FAILED", {
                reason: "bad password",
                identifier: value,
                ip: req.ip
            });

            return res.status(401).json({
                message: "Invalid username/email or password"
            });
        }

        const token = signToken(user._id);

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            message: "Internal server error"
        });
    }
});

// Get the currently authenticated user's profile.
router.get("/api/auth/me", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select("username email")
            .lean();

        if (!user) {
            return res.status(401).json({
                message: "Authenticated user not found"
            });
        }

        return res.status(200).json({
            user: {
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Profile retrieval error:", error.message);

        return res.status(500).json({
            message: "Could not retrieve user profile"
        });
    }
});

module.exports = router;
