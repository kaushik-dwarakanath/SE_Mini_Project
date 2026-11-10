const Message = require("../models/Message");

const toDto = (doc, usernameOverride) => {
    const sender = doc.senderId;
    return {
        id: String(doc._id),
        roomId: doc.roomId,
        text: doc.content,
        senderId: String(sender?._id ?? sender),
        username: usernameOverride ?? sender?.username ?? "Unknown",
        timestamp: new Date(doc.createdAt).toISOString()
    };
};

async function saveMessage({ senderId, username, roomId, content }) {
    const doc = await Message.create({ senderId, roomId, content });
    return toDto(doc, username);
}

// `since` (ISO string) lets a reconnecting client fetch only what it missed (NFR-004).
async function getHistory(roomId, since, limit = 100) {
    const query = { roomId };

    if (since) {
        const date = new Date(since);
        if (!Number.isNaN(date.getTime())) {
            query.createdAt = { $gt: date };
        }
    }

    const docs = await Message.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("senderId", "username")
        .lean();

    return docs.reverse().map((doc) => toDto(doc));
}

module.exports = { saveMessage, getHistory, toDto };