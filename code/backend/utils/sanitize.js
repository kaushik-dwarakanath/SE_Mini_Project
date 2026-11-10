const MAX_MESSAGE_LENGTH = 1000;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

// Strips control characters and HTML tags, trims, and caps length.
// Output is plain text. The client must still render it as text
// (React's {message.text} escapes it), which satisfies SEC-005.
// We strip instead of HTML-escaping to avoid double-escaping on the client.
function sanitizeMessage(text) {
    if (typeof text !== "string") return "";

    return text
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/<[^>]*>?/g, "")
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH);
}

function isValidRoomId(roomId) {
    return typeof roomId === "string" && ROOM_ID_PATTERN.test(roomId);
}

module.exports = { sanitizeMessage, isValidRoomId, MAX_MESSAGE_LENGTH };