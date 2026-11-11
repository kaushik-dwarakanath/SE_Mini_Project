
process.env.NODE_ENV = "test";

jest.mock("../services/messageService");
jest.mock("../utils/logger");

const messageService = require("../services/messageService");
const {
    registerChatHandlers,
    MAX_CATCHUP_PAGES
} = require("../sockets/chatHandlers");

const makeSocket = (
    tokenExp = Math.floor(Date.now() / 1000) + 3600,
    id = "s1",
    user = { id: "u1", username: "alice" }
) => {
    const handlers = {};
    const socket = {
        id,
        data: { user, tokenExp },
        rooms: new Set(),
        handlers,
        on: (event, fn) => { handlers[event] = fn; },
        emit: jest.fn(),
        toEmit: jest.fn(),
        to: jest.fn(() => ({ emit: socket.toEmit })),
        disconnect: jest.fn()
    };

    socket.join = jest.fn((room) => socket.rooms.add(room));

    return socket;
};

const makeIo = () => {
    const emit = jest.fn();
    return {
        to: jest.fn(() => ({ emit })),
        roomEmit: emit
    };
};

const emptyPage = {
    messages: [],
    hasMore: false,
    nextCursor: null
};

beforeEach(() => {
    jest.clearAllMocks();

    messageService.getHistory.mockResolvedValue([]);
    messageService.getMessagesPage.mockResolvedValue(emptyPage);
    messageService.saveMessage.mockImplementation(async (m) => ({
        ...m,
        text: m.content,
        id: "m1"
    }));
});

describe("chat handlers: messages", () => {
    test("saves a sanitized message and broadcasts to the room (TC-SEC-03)", async () => {
        const socket = makeSocket();
        const io = makeIo();

        registerChatHandlers(io, socket);

        await socket.handlers.message({
            text: "<b>hello</b>",
            roomId: "general"
        });

        expect(messageService.saveMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: "hello",
                roomId: "general",
                senderId: "u1"
            })
        );

        expect(io.to).toHaveBeenCalledWith("general");
        expect(io.roomEmit).toHaveBeenCalledWith(
            "new_message",
            expect.any(Object)
        );
    });

    test("rejects messages to a room the socket has not joined (TC-SEC-02)", async () => {
        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.message({
            text: "hi",
            roomId: "secret"
        });

        expect(messageService.saveMessage).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith(
            "message_error",
            expect.any(Object)
        );
    });

    test("rejects empty messages after sanitizing", async () => {
        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.message({
            text: "<script></script>"
        });

        expect(messageService.saveMessage).not.toHaveBeenCalled();
    });

    test("disconnects a socket whose token has expired (TC-SEC-04)", async () => {
        const socket = makeSocket(
            Math.floor(Date.now() / 1000) - 5
        );

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.message({ text: "hi" });

        expect(socket.emit).toHaveBeenCalledWith(
            "auth_error",
            expect.any(Object)
        );

        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(messageService.saveMessage).not.toHaveBeenCalled();
    });
});

describe("chat handlers: multi-tab typing", () => {
    test("does not clear typing when an idle second tab disconnects", () => {
        const io = makeIo();
        const user = {
            id: "multi-tab-user-1",
            username: "alice"
        };

        const tabA = makeSocket(undefined, "tab-a-1", user);
        const tabB = makeSocket(undefined, "tab-b-1", user);

        registerChatHandlers(io, tabA);
        registerChatHandlers(io, tabB);

        tabA.handlers.typing({ roomId: "general" });

        expect(tabA.toEmit).toHaveBeenCalledWith(
            "typing_status",
            expect.objectContaining({
                userId: user.id,
                isTyping: true
            })
        );

        tabB.handlers.disconnecting("client disconnect");

        // The idle tab must not broadcast a stop-typing event.
        expect(tabB.toEmit).not.toHaveBeenCalled();
    });

    test("clears typing only when the last active typing socket stops", () => {
        const io = makeIo();
        const user = {
            id: "multi-tab-user-2",
            username: "alice"
        };

        const tabA = makeSocket(undefined, "tab-a-2", user);
        const tabB = makeSocket(undefined, "tab-b-2", user);

        registerChatHandlers(io, tabA);
        registerChatHandlers(io, tabB);

        tabA.handlers.typing({ roomId: "general" });
        tabB.handlers.typing({ roomId: "general" });

        tabA.handlers.stop_typing({ roomId: "general" });

        // Tab B is still typing, so no false event should be emitted.
        expect(tabA.toEmit).not.toHaveBeenCalledWith(
            "typing_status",
            expect.objectContaining({ isTyping: false })
        );

        tabB.handlers.stop_typing({ roomId: "general" });

        // The final active typing socket stops.
        expect(tabB.toEmit).toHaveBeenCalledWith(
            "typing_status",
            expect.objectContaining({
                userId: user.id,
                isTyping: false
            })
        );
    });

    test("clears typing only when the last active typing socket disconnects", () => {
        const io = makeIo();
        const user = {
            id: "multi-tab-user-3",
            username: "alice"
        };

        const tabA = makeSocket(undefined, "tab-a-3", user);
        const tabB = makeSocket(undefined, "tab-b-3", user);

        registerChatHandlers(io, tabA);
        registerChatHandlers(io, tabB);

        tabA.handlers.typing({ roomId: "general" });
        tabB.handlers.typing({ roomId: "general" });

        tabA.handlers.disconnecting("client disconnect");

        // Tab B remains active.
        expect(tabA.toEmit).not.toHaveBeenCalledWith(
            "typing_status",
            expect.objectContaining({ isTyping: false })
        );

        tabB.handlers.disconnecting("client disconnect");

        // The final active socket disconnects.
        expect(tabB.toEmit).toHaveBeenCalledWith(
            "typing_status",
            expect.objectContaining({
                userId: user.id,
                isTyping: false
            })
        );
    });
});

describe("chat handlers: join_room and reconnect catch-up (TC-REL-01)", () => {
    test("join_room without since/cursor sends the latest history", async () => {
        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({ roomId: "room-2" });

        expect(socket.join).toHaveBeenCalledWith("room-2");
        expect(messageService.getHistory).toHaveBeenCalledWith("room-2");
        expect(messageService.getMessagesPage).not.toHaveBeenCalled();
    });

    test("join_room with since sends missed messages", async () => {
        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({
            roomId: "room-2",
            since: "2026-01-01T00:00:00Z"
        });

        expect(socket.join).toHaveBeenCalledWith("room-2");

        expect(messageService.getMessagesPage).toHaveBeenCalledWith(
            "room-2",
            {
                since: "2026-01-01T00:00:00Z",
                cursor: undefined
            }
        );

        expect(socket.emit).toHaveBeenCalledWith(
            "missed_messages",
            expect.objectContaining({ roomId: "room-2" })
        );
    });

    test("keeps fetching pages until nothing more is missed", async () => {
        messageService.getMessagesPage
            .mockResolvedValueOnce({
                messages: [{ id: "a" }],
                hasMore: true,
                nextCursor: "c1"
            })
            .mockResolvedValueOnce({
                messages: [{ id: "b" }],
                hasMore: true,
                nextCursor: "c2"
            })
            .mockResolvedValueOnce({
                messages: [{ id: "c" }],
                hasMore: false,
                nextCursor: "c3"
            });

        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({
            roomId: "general",
            cursor: "c0"
        });

        expect(messageService.getMessagesPage).toHaveBeenNthCalledWith(
            1,
            "general",
            { since: undefined, cursor: "c0" }
        );

        expect(messageService.getMessagesPage).toHaveBeenNthCalledWith(
            2,
            "general",
            { cursor: "c1" }
        );

        expect(messageService.getMessagesPage).toHaveBeenNthCalledWith(
            3,
            "general",
            { cursor: "c2" }
        );

        const missed = socket.emit.mock.calls.filter(
            ([event]) => event === "missed_messages"
        );

        expect(missed).toHaveLength(3);
        expect(missed.map(([, payload]) => payload.messages[0].id))
            .toEqual(["a", "b", "c"]);

        expect(missed[2][1].hasMore).toBe(false);
    });

    test("stops at the page cap and tells the client how to continue", async () => {
        messageService.getMessagesPage.mockResolvedValue({
            messages: [{ id: "x" }],
            hasMore: true,
            nextCursor: "next"
        });

        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({
            roomId: "general",
            since: "2026-01-01T00:00:00Z"
        });

        expect(messageService.getMessagesPage).toHaveBeenCalledTimes(
            MAX_CATCHUP_PAGES
        );

        const missed = socket.emit.mock.calls.filter(
            ([event]) => event === "missed_messages"
        );

        const lastPayload = missed[missed.length - 1][1];

        expect(lastPayload.hasMore).toBe(true);
        expect(lastPayload.nextCursor).toBe("next");
    });

    test("reports an invalid cursor to the client", async () => {
        const err = new Error("Invalid cursor");
        err.code = "INVALID_PAGINATION";

        messageService.getMessagesPage.mockRejectedValue(err);

        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({
            roomId: "general",
            cursor: "garbage"
        });

        expect(socket.emit).toHaveBeenCalledWith(
            "message_error",
            expect.any(Object)
        );
    });

    test("ignores non-string since/cursor values (NoSQL operator objects)", async () => {
        const socket = makeSocket();

        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({
            roomId: "general",
            since: { $gt: "" },
            cursor: { $ne: "" }
        });

        expect(messageService.getMessagesPage).not.toHaveBeenCalled();
        expect(messageService.getHistory).toHaveBeenCalledWith("general");
    });
});
