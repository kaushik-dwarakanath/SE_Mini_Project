const { sanitizeMessage, isValidRoomId } = require("../utils/sanitize");
const messageService = require("../services/messageService");
const logger = require("../utils/logger");

const DEFAULT_ROOM = "general";
// Safety cap per join_room request. If a client missed more than this, the last
// "missed_messages" event has hasMore: true and the client continues with its nextCursor.
const MAX_CATCHUP_PAGES = 10;

const isTokenExpired = (socket) =>
    Boolean(socket.data.tokenExp) && Date.now() / 1000 >= socket.data.tokenExp;

function rejectExpired(socket) {
    logger.warn("SOCKET_TOKEN_EXPIRED", { userId: socket.data.user.id, socketId: socket.id });
    socket.emit("auth_error", { message: "Session expired. Please log in again." });
    socket.disconnect(true);
}

// Initial load: the latest messages of the room.
async function sendHistory(socket, roomId) {
    try {
        const history = await messageService.getHistory(roomId);
        socket.emit("chat_history", history);
    } catch (error) {
        console.error("History error:", error.message);
        socket.emit("message_error", { message: "Could not load chat history" });
    }
}

// Reconnect catch-up: streams EVERY missed message, oldest first, page by page.
// Each page is a "missed_messages" event: { roomId, messages, hasMore, nextCursor }.
async function sendMissed(socket, roomId, { since, cursor }) {
    try {
        let position = { since, cursor };

        for (let page = 0; page < MAX_CATCHUP_PAGES; page++) {
            const result = await messageService.getMessagesPage(roomId, position);
            socket.emit("missed_messages", { roomId, ...result });

            if (!result.hasMore) return;
            position = { cursor: result.nextCursor };
        }
    } catch (error) {
        if (error.code === "INVALID_PAGINATION") {
            return socket.emit("message_error", { message: "Invalid since or cursor value" });
        }
        console.error("Catch-up error:", error.message);
        socket.emit("message_error", { message: "Could not load missed messages" });
    }
}

function registerChatHandlers(io, socket) {
    // Auto-join the default room so existing clients keep working.
    socket.join(DEFAULT_ROOM);
    sendHistory(socket, DEFAULT_ROOM);

    // Disconnect when the JWT expires, even if the client stays idle (SEC-004).
    let expiryTimer;
    if (socket.data.tokenExp) {
        const ms = Math.max(socket.data.tokenExp * 1000 - Date.now(), 0);
        expiryTimer = setTimeout(() => rejectExpired(socket), ms);
        if (expiryTimer.unref) expiryTimer.unref();
    }

    // data: { roomId, since?, cursor? }
    //  - no since/cursor: join and receive the latest messages ("chat_history")
    //  - since or cursor: join and receive all missed messages ("missed_messages")
    // Clients should prefer `cursor` (the cursor of the last message they saw).
    socket.on("join_room", async (data) => {
        if (isTokenExpired(socket)) return rejectExpired(socket);

        const roomId = typeof data === "string" ? data : data?.roomId;
        const since = typeof data?.since === "string" ? data.since : undefined;
        const cursor = typeof data?.cursor === "string" ? data.cursor : undefined;

        if (!isValidRoomId(roomId)) {
            return socket.emit("message_error", { message: "Invalid room" });
        }

        socket.join(roomId);

        if (since || cursor) {
            await sendMissed(socket, roomId, { since, cursor });
        } else {
            await sendHistory(socket, roomId);
        }
    });

    // data: { text, roomId? }
    socket.on("message", async (data) => {
        if (isTokenExpired(socket)) return rejectExpired(socket);

        const roomId = data?.roomId ?? DEFAULT_ROOM;

        if (!isValidRoomId(roomId) || !socket.rooms.has(roomId)) {
            return socket.emit("message_error", { message: "Join the room before sending messages" });
        }

        const content = sanitizeMessage(data?.text);

        if (!content) {
            return socket.emit("message_error", { message: "Message text is required" });
        }

        try {
            const saved = await messageService.saveMessage({
                senderId: socket.data.user.id,
                username: socket.data.user.username,
                roomId,
                content
            });

            io.to(roomId).emit("new_message", saved);
        } catch (error) {
            console.error("Message save error:", error.message);
            socket.emit("message_error", { message: "Message could not be sent" });
        }
    });

    socket.on("disconnect", (reason) => {
        clearTimeout(expiryTimer);
        logger.info("SOCKET_DISCONNECTED", { socketId: socket.id, reason });
    });
}

module.exports = { registerChatHandlers, DEFAULT_ROOM, MAX_CATCHUP_PAGES };