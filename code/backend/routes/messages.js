const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const messageService = require("../services/messageService");
const { isValidRoomId } = require("../utils/sanitize");

const router = express.Router();

// GET /api/messages/:roomId
//   no query            -> latest messages:            { messages }
//   ?since= or ?cursor= -> missed messages, oldest first: { messages, hasMore, nextCursor }
//   optional ?limit= (max 200). While hasMore is true, call again with ?cursor=<nextCursor>.
router.get("/:roomId", authMiddleware, async (req, res) => {
    const { roomId } = req.params;

    if (!isValidRoomId(roomId)) {
        return res.status(400).json({ message: "Invalid room" });
    }

    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = Number.parseInt(req.query.limit, 10) || undefined;

    try {
        if (since || cursor) {
            const page = await messageService.getMessagesPage(roomId, { since, cursor, limit });
            return res.status(200).json(page);
        }

        const messages = await messageService.getHistory(roomId);
        return res.status(200).json({ messages });
    } catch (error) {
        if (error.code === "INVALID_PAGINATION") {
            return res.status(400).json({ message: error.message });
        }

        console.error("Fetch messages error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
});

module.exports = router;