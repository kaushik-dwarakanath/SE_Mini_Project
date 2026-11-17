// TC-SEC-05 (SEC-005): render message content safely.
// Part 1 (server): XSS payloads sent through the real chat handler never reach
//   storage or the broadcast with tag markup.
// Part 2 (client): static review of the frontend source for unsafe HTML sinks,
//   so React keeps rendering message text as text. Skipped if the frontend
//   folder is not next to the backend folder.
process.env.NODE_ENV = "test";

jest.mock("../services/messageService");
jest.mock("../utils/logger");

const fs = require("fs");
const path = require("path");
const messageService = require("../services/messageService");
const { sanitizeMessage } = require("../utils/sanitize");
const { registerChatHandlers } = require("../sockets/chatHandlers");

const PAYLOADS = [
    ["script tag", "<script>alert(1)</script>"],
    ["img onerror", "<img src=x onerror=alert(1)>"],
    ["svg onload", "<svg onload=alert(1)>"],
    ["anchor with javascript: URL", '<a href="javascript:alert(1)">click</a>'],
    ["attribute breakout", '"><script>alert(1)</script>'],
    ["nested tag evasion", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
    ["unclosed tag", "<img src=x onerror=alert(1)"],
    ["uppercase tag", "<SCRIPT>alert(1)</SCRIPT>"],
    ["iframe", '<iframe src="javascript:alert(1)"></iframe>'],
    ["control characters around a tag", "\u0000<b>hi\u0007</b>"]
];

const makeSocket = () => {
    const handlers = {};
    const socket = {
        id: "s1",
        data: { user: { id: "u1", username: "alice" }, tokenExp: Math.floor(Date.now() / 1000) + 3600 },
        rooms: new Set(),
        handlers,
        on: (event, fn) => { handlers[event] = fn; },
        emit: jest.fn(),
        disconnect: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() }))
    };
    socket.join = jest.fn((room) => socket.rooms.add(room));
    return socket;
};

const makeIo = () => {
    const emit = jest.fn();
    return { to: jest.fn(() => ({ emit })), roomEmit: emit };
};

const sendThroughHandler = async (text) => {
    const socket = makeSocket();
    const io = makeIo();
    registerChatHandlers(io, socket);
    await socket.handlers.message({ text, roomId: "general" });
    return { socket, io };
};

beforeEach(() => {
    jest.clearAllMocks();
    messageService.getHistory.mockResolvedValue([]);
    messageService.saveMessage.mockImplementation(async (m) => ({ ...m, text: m.content, id: "m1" }));
});

describe("server-side sanitization of XSS payloads (TC-SEC-05)", () => {
    test.each(PAYLOADS)("sanitizeMessage leaves no tag markup: %s", (_name, payload) => {
        expect(sanitizeMessage(payload)).not.toContain("<");
    });

    test.each(PAYLOADS)("nothing with tag markup is stored or broadcast: %s", async (_name, payload) => {
        const { socket, io } = await sendThroughHandler(payload);

        if (messageService.saveMessage.mock.calls.length > 0) {
            const stored = messageService.saveMessage.mock.calls[0][0].content;
            const [event, broadcast] = io.roomEmit.mock.calls[0];

            expect(stored).not.toContain("<");
            expect(event).toBe("new_message");
            expect(broadcast.text).not.toContain("<");
        } else {
            // everything was markup, so the message is rejected instead of stored
            expect(socket.emit).toHaveBeenCalledWith("message_error", expect.any(Object));
            expect(io.roomEmit).not.toHaveBeenCalled();
        }
    });

    test("a script tag keeps only its inert text", async () => {
        await sendThroughHandler("<script>alert(1)</script>");
        expect(messageService.saveMessage.mock.calls[0][0].content).toBe("alert(1)");
    });

    test("a message that is only an event-handler tag is rejected", async () => {
        const { socket } = await sendThroughHandler("<img src=x onerror=alert(1)>");
        expect(messageService.saveMessage).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith("message_error", expect.any(Object));
    });

    test("link text survives but the javascript: URL is removed", async () => {
        await sendThroughHandler('<a href="javascript:alert(1)">click</a>');
        expect(messageService.saveMessage.mock.calls[0][0].content).toBe("click");
    });

    test("HTML entities are left as literal text and never decoded into markup", async () => {
        const text = "&lt;script&gt;alert(1)&lt;/script&gt;";
        await sendThroughHandler(text);
        expect(messageService.saveMessage.mock.calls[0][0].content).toBe(text);
    });
});

// ---------------- client static review ----------------

const FRONTEND_SRC = path.join(__dirname, "..", "..", "frontend", "src");
const frontendExists = fs.existsSync(FRONTEND_SRC);

const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === "node_modules") return [];
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });

const FORBIDDEN_SINKS = [
    /dangerouslySetInnerHTML/,
    /\.innerHTML\s*=/,
    /\.outerHTML\s*=/,
    /insertAdjacentHTML/,
    /document\.write\(/,
    /\beval\(/,
    /new Function\(/
];

(frontendExists ? describe : describe.skip)("client static review: no unsafe HTML sinks (TC-SEC-05)", () => {
    const files = frontendExists
        ? walk(FRONTEND_SRC).filter((file) => /\.(jsx?|tsx?)$/.test(file))
        : [];

    test("frontend source files were found", () => {
        expect(files.length).toBeGreaterThan(0);
    });

    test.each(FORBIDDEN_SINKS.map((pattern) => [String(pattern), pattern]))(
        "no source file uses %s",
        (_label, pattern) => {
            const offenders = files
                .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
                .map((file) => path.relative(FRONTEND_SRC, file));

            expect(offenders).toEqual([]);
        }
    );

    test("Chat.jsx renders the message text as a React text child", () => {
        const chat = files.find((file) => path.basename(file) === "Chat.jsx");
        if (!chat) return;

        expect(fs.readFileSync(chat, "utf8")).toMatch(/\{\s*message\.text\s*\}/);
    });
});