const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

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
            $or: [
                { username },
                { email }
            ]
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

router.post("/login", async (req, res) => {
    try {
        const { identifier, username, email, password } = req.body;

        // Accept a single identifier, or a username/email field.
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

        // Search by username or email.
        const user = await User.findOne({
            $or: [
                { username: value },
                { email: value.toLowerCase() }
            ]
        });

        // Use the same error for unknown users and wrong passwords.
        if (!user) {
            return res.status(401).json({
                message: "Invalid username/email or password"
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid username/email or password"
            });
        }

        // Generate a JWT valid for one hour.
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not configured");
        }

        const token = require("jsonwebtoken").sign(
            { userId: user._id.toString() },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

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

module.exports = router;
