const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const messageService = require("../services/messageService");
const { isValidRoomId } = require("../utils/sanitize");

const router = express.Router();

// GET /api/messages/:roomId?since=<ISO date>
router.get("/:roomId", authMiddleware, async (req, res) => {
    const { roomId } = req.params;

    if (!isValidRoomId(roomId)) {
        return res.status(400).json({ message: "Invalid room" });
    }

    try {
        const since = typeof req.query.since === "string" ? req.query.since : undefined;
        const messages = await messageService.getHistory(roomId, since);
        return res.status(200).json({ messages });
    } catch (error) {
        console.error("Fetch messages error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
});

module.exports = router;