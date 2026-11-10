process.env.NODE_ENV = "test";

jest.mock("../services/messageService");
jest.mock("../utils/logger");
const messageService = require("../services/messageService");
const { registerChatHandlers } = require("../sockets/chatHandlers");

const makeSocket = (tokenExp = Math.floor(Date.now() / 1000) + 3600) => {
    const handlers = {};
    const socket = {
        id: "s1",
        data: { user: { id: "u1", username: "alice" }, tokenExp },
        rooms: new Set(),
        handlers,
        on: (event, fn) => { handlers[event] = fn; },
        emit: jest.fn(),
        disconnect: jest.fn()
    };
    socket.join = jest.fn((room) => socket.rooms.add(room));
    return socket;
};

const makeIo = () => {
    const emit = jest.fn();
    return { to: jest.fn(() => ({ emit })), roomEmit: emit };
};

beforeEach(() => {
    jest.clearAllMocks();
    messageService.getHistory.mockResolvedValue([]);
    messageService.saveMessage.mockImplementation(async (m) => ({ ...m, text: m.content, id: "m1" }));
});

describe("chat handlers", () => {
    test("saves a sanitized message and broadcasts to the room (TC-SEC-03)", async () => {
        const socket = makeSocket();
        const io = makeIo();
        registerChatHandlers(io, socket);

        await socket.handlers.message({ text: "<b>hello</b>", roomId: "general" });

        expect(messageService.saveMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: "hello", roomId: "general", senderId: "u1" })
        );
        expect(io.to).toHaveBeenCalledWith("general");
        expect(io.roomEmit).toHaveBeenCalledWith("new_message", expect.any(Object));
    });

    test("rejects messages to a room the socket has not joined (TC-SEC-02)", async () => {
        const socket = makeSocket();
        registerChatHandlers(makeIo(), socket);

        await socket.handlers.message({ text: "hi", roomId: "secret" });

        expect(messageService.saveMessage).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith("message_error", expect.any(Object));
    });

    test("rejects empty messages after sanitizing", async () => {
        const socket = makeSocket();
        registerChatHandlers(makeIo(), socket);

        await socket.handlers.message({ text: "<script></script>" });

        expect(messageService.saveMessage).not.toHaveBeenCalled();
    });

    test("disconnects a socket whose token has expired (TC-SEC-04)", async () => {
        const socket = makeSocket(Math.floor(Date.now() / 1000) - 5);
        registerChatHandlers(makeIo(), socket);

        await socket.handlers.message({ text: "hi" });

        expect(socket.emit).toHaveBeenCalledWith("auth_error", expect.any(Object));
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(messageService.saveMessage).not.toHaveBeenCalled();
    });

    test("join_room joins and sends history since the given time (TC-REL-01)", async () => {
        const socket = makeSocket();
        registerChatHandlers(makeIo(), socket);

        await socket.handlers.join_room({ roomId: "room-2", since: "2026-01-01T00:00:00Z" });

        expect(socket.join).toHaveBeenCalledWith("room-2");
        expect(messageService.getHistory).toHaveBeenCalledWith("room-2", "2026-01-01T00:00:00Z");
    });
});