const { sanitizeMessage, isValidRoomId } = require("../utils/sanitize");
const messageService = require("../services/messageService");
const logger = require("../utils/logger");

const DEFAULT_ROOM = "general";

const isTokenExpired = (socket) =>
    Boolean(socket.data.tokenExp) && Date.now() / 1000 >= socket.data.tokenExp;

function rejectExpired(socket) {
    logger.warn("SOCKET_TOKEN_EXPIRED", { userId: socket.data.user.id, socketId: socket.id });
    socket.emit("auth_error", { message: "Session expired. Please log in again." });
    socket.disconnect(true);
}

async function sendHistory(socket, roomId, since) {
    try {
        const history = await messageService.getHistory(roomId, since);
        socket.emit("chat_history", history);
    } catch (error) {
        console.error("History error:", error.message);
        socket.emit("message_error", { message: "Could not load chat history" });
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

    // data: { roomId, since? }  (since = ISO timestamp of last message the client saw)
    socket.on("join_room", async (data) => {
        if (isTokenExpired(socket)) return rejectExpired(socket);

        const roomId = typeof data === "string" ? data : data?.roomId;
        const since = typeof data === "object" ? data?.since : undefined;

        if (!isValidRoomId(roomId)) {
            return socket.emit("message_error", { message: "Invalid room" });
        }

        socket.join(roomId);
        await sendHistory(socket, roomId, since);
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

module.exports = { registerChatHandlers, DEFAULT_ROOM };