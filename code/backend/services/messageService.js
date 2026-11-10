const Message = require("../models/Message");

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const paginationError = (message) => {
    const err = new Error(message);
    err.code = "INVALID_PAGINATION";
    return err;
};

// A cursor points at one exact message: (createdAt, _id). Using both makes
// paging safe even when several messages share the same millisecond.
const encodeCursor = (doc) =>
    Buffer.from(
        JSON.stringify({
            t: new Date(doc.createdAt).toISOString(),
            id: String(doc._id)
        })
    ).toString("base64url");

function decodeCursor(cursor) {
    try {
        if (typeof cursor !== "string") throw new Error();

        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        const t = new Date(parsed.t);

        if (Number.isNaN(t.getTime()) || !OBJECT_ID_PATTERN.test(parsed.id)) {
            throw new Error();
        }

        return { t, id: parsed.id };
    } catch {
        throw paginationError("Invalid cursor");
    }
}

const toDto = (doc, usernameOverride) => {
    const sender = doc.senderId;
    return {
        id: String(doc._id),
        roomId: doc.roomId,
        text: doc.content,
        senderId: String(sender?._id ?? sender),
        username: usernameOverride ?? sender?.username ?? "Unknown",
        timestamp: new Date(doc.createdAt).toISOString(),
        cursor: encodeCursor(doc)
    };
};

async function saveMessage({ senderId, username, roomId, content }) {
    const doc = await Message.create({ senderId, roomId, content });
    return toDto(doc, username);
}

// Latest messages for a room, oldest first. Use this for the INITIAL load only.
// It is NOT suitable for reconnect catch-up (it would skip older missed messages).
async function getHistory(roomId, limit = DEFAULT_PAGE_SIZE) {
    const docs = await Message.find({ roomId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .populate("senderId", "username")
        .lean();

    return docs.reverse().map((doc) => toDto(doc));
}

function buildAfterFilter({ since, cursor }) {
    if (cursor) {
        const c = decodeCursor(cursor);
        return {
            $or: [
                { createdAt: { $gt: c.t } },
                { createdAt: c.t, _id: { $gt: c.id } }
            ]
        };
    }

    if (since) {
        const date = new Date(since);
        if (Number.isNaN(date.getTime())) throw paginationError("Invalid since value");
        return { createdAt: { $gt: date } };
    }

    return {};
}

// Returns messages AFTER the given cursor (or `since` time), OLDEST FIRST, so
// repeated calls walk forward through everything that was missed (NFR-004).
//   { messages, hasMore, nextCursor }
// Call again with { cursor: nextCursor } while hasMore is true.
// `cursor` takes precedence over `since`.
async function getMessagesPage(roomId, { since, cursor, limit } = {}) {
    const pageSize = Math.min(
        Math.max(Number.parseInt(limit, 10) || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
    );

    const query = { roomId, ...buildAfterFilter({ since, cursor }) };

    // Fetch one extra row to know whether another page exists.
    const docs = await Message.find(query)
        .sort({ createdAt: 1, _id: 1 })
        .limit(pageSize + 1)
        .populate("senderId", "username")
        .lean();

    const hasMore = docs.length > pageSize;
    const page = hasMore ? docs.slice(0, pageSize) : docs;
    const last = page[page.length - 1];

    return {
        messages: page.map((doc) => toDto(doc)),
        hasMore,
        nextCursor: last ? encodeCursor(last) : null
    };
}

module.exports = {
    saveMessage,
    getHistory,
    getMessagesPage,
    toDto,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
};