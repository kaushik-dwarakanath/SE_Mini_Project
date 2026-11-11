
const { sanitizeMessage, isValidRoomId } = require("../utils/sanitize");
const messageService = require("../services/messageService");
const logger = require("../utils/logger");

const DEFAULT_ROOM = "general";
const MAX_CATCHUP_PAGES = 10;

const isTokenExpired = (socket) =>
    Boolean(socket.data.tokenExp) && Date.now() / 1000 >= socket.data.tokenExp;

function rejectExpired(socket) {
    logger.warn("SOCKET_TOKEN_EXPIRED", {
        userId: socket.data.user.id,
        socketId: socket.id
    });

    socket.emit("auth_error", {
        message: "Session expired. Please log in again."
    });

    socket.disconnect(true);
}

async function sendHistory(socket, roomId) {
    try {
        const history = await messageService.getHistory(roomId);
        socket.emit("chat_history", history);
    } catch (error) {
        console.error("History error:", error.message);
        socket.emit("message_error", {
            message: "Could not load chat history"
        });
    }
}

async function sendMissed(socket, roomId, { since, cursor }) {
    try {
        let position = { since, cursor };

        for (let page = 0; page < MAX_CATCHUP_PAGES; page++) {
            const result = await messageService.getMessagesPage(
                roomId,
                position
            );

            socket.emit("missed_messages", {
                roomId,
                ...result
            });

            if (!result.hasMore) return;

            position = { cursor: result.nextCursor };
        }
    } catch (error) {
        if (error.code === "INVALID_PAGINATION") {
            return socket.emit("message_error", {
                message: "Invalid since or cursor value"
            });
        }

        console.error("Catch-up error:", error.message);
        socket.emit("message_error", {
            message: "Could not load missed messages"
        });
    }
}

function registerChatHandlers(io, socket) {
    socket.join(DEFAULT_ROOM);
    sendHistory(socket, DEFAULT_ROOM);

    let expiryTimer;

    if (socket.data.tokenExp) {
        const ms = Math.max(
            socket.data.tokenExp * 1000 - Date.now(),
            0
        );

        expiryTimer = setTimeout(() => rejectExpired(socket), ms);

        if (expiryTimer.unref) expiryTimer.unref();
    }

    socket.on("join_room", async (data) => {
        if (isTokenExpired(socket)) return rejectExpired(socket);

        const roomId =
            typeof data === "string" ? data : data?.roomId;

        const since =
            typeof data?.since === "string" ? data.since : undefined;

        const cursor =
            typeof data?.cursor === "string" ? data.cursor : undefined;

        if (!isValidRoomId(roomId)) {
            return socket.emit("message_error", {
                message: "Invalid room"
            });
        }

        socket.join(roomId);

        if (since || cursor) {
            await sendMissed(socket, roomId, { since, cursor });
        } else {
            await sendHistory(socket, roomId);
        }
    });

    // Relay typing status only to other participants in the room.
    function relayTyping(roomId, isTyping) {
        if (isTokenExpired(socket)) return rejectExpired(socket);

        if (!isValidRoomId(roomId) || !socket.rooms.has(roomId)) {
            return;
        }

        socket.to(roomId).emit("typing_status", {
            userId: socket.data.user.id,
            username: socket.data.user.username,
            isTyping
        });
    }

    socket.on("typing", (data) => {
        relayTyping(data?.roomId ?? DEFAULT_ROOM, true);
    });

    socket.on("stop_typing", (data) => {
        relayTyping(data?.roomId ?? DEFAULT_ROOM, false);
    });

    socket.on("message", async (data) => {
        if (isTokenExpired(socket)) return rejectExpired(socket);

        const roomId = data?.roomId ?? DEFAULT_ROOM;

        if (!isValidRoomId(roomId) || !socket.rooms.has(roomId)) {
            return socket.emit("message_error", {
                message: "Join the room before sending messages"
            });
        }

        const content = sanitizeMessage(data?.text);

        if (!content) {
            return socket.emit("message_error", {
                message: "Message text is required"
            });
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
            socket.emit("message_error", {
                message: "Message could not be sent"
            });
        }
    });

    // Socket.IO retains room membership during disconnecting.
    socket.on("disconnecting", (reason) => {
        clearTimeout(expiryTimer);

        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                socket.to(roomId).emit("typing_status", {
                    userId: socket.data.user.id,
                    username: socket.data.user.username,
                    isTyping: false
                });
            }
        }

        logger.info("SOCKET_DISCONNECTING", {
            socketId: socket.id,
            reason
        });
    });
}

module.exports = {
    registerChatHandlers,
    DEFAULT_ROOM,
    MAX_CATCHUP_PAGES
};
