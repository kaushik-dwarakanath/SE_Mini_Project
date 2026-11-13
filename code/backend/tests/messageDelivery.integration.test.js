// Issue #17 — Test sending and receiving messages (TC-MSG-02, TC-ROOM-01, TC-SEC-03, TC-PERF-01).
// Integration tests: real Socket.IO server, real chat handlers, real message
// service and sanitizer, real socket.io-client clients. Only the Mongoose
// models are mocked (an in-memory Message.create), so no MongoDB is needed.
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../models/User");
jest.mock("../models/Message");
jest.mock("../utils/logger");

const User = require("../models/User");
const Message = require("../models/Message");
const { signToken } = require("../services/tokenService");
const { DEFAULT_ROOM } = require("../sockets/chatHandlers");
const { MAX_MESSAGE_LENGTH } = require("../utils/sanitize");
const {
    startSocketServer,
    waitForEvent,
    waitForConnect,
    waitUntil,
    recordEvents
} = require("./helpers/socketTestServer");

const USERS = {
    alice: { _id: "64b7f0c2a1b2c3d4e5f60001", username: "alice" },
    bob: { _id: "64b7f0c2a1b2c3d4e5f60002", username: "bob" },
    carol: { _id: "64b7f0c2a1b2c3d4e5f60003", username: "carol" }
};

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let server;
let savedMessages;

function installFakeDatabase() {
    savedMessages = [];
    let nextId = 1;

    User.findById.mockImplementation((id) => ({
        select: jest.fn().mockResolvedValue(
            Object.values(USERS).find((user) => user._id === String(id)) ?? null
        )
    }));

    Message.create.mockImplementation(async ({ senderId, roomId, content }) => {
        const doc = {
            _id: (nextId++).toString(16).padStart(24, "0"),
            senderId,
            roomId,
            content,
            createdAt: new Date()
        };
        savedMessages.push(doc);
        return doc;
    });

    // Initial history on connect: an empty room.
    Message.find.mockImplementation(() => {
        const chain = {
            sort: () => chain,
            limit: () => chain,
            populate: () => chain,
            lean: async () => []
        };
        return chain;
    });
}

// Connects a user and waits until the server has joined them to the shared room.
async function connectAs(user) {
    const client = server.connect(signToken(user._id));
    const history = waitForEvent(client, "chat_history");
    await waitForConnect(client);
    await history;
    return client;
}

beforeEach(async () => {
    jest.clearAllMocks();
    installFakeDatabase();
    server = await startSocketServer();
});

afterEach(async () => {
    await server.close();
});

describe("two clients in the shared room (TC-ROOM-01, TC-MSG-02)", () => {
    test("both clients are members of the shared room after connecting", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);

        expect(server.io.of("/").adapter.rooms.get(DEFAULT_ROOM)).toEqual(new Set([alice.id, bob.id]));
    });

    test("a message from the first client reaches the second client", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");

        alice.emit("message", { text: "Hello Bob" });

        await expect(received).resolves.toEqual({
            id: expect.stringMatching(/^[a-f0-9]{24}$/),
            roomId: DEFAULT_ROOM,
            text: "Hello Bob",
            senderId: USERS.alice._id,
            username: "alice",
            timestamp: expect.stringMatching(ISO_TIMESTAMP),
            cursor: expect.any(String)
        });
    });

    test("a message from the second client reaches the first client", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(alice, "new_message");

        bob.emit("message", { text: "Hi Alice", roomId: DEFAULT_ROOM });

        await expect(received).resolves.toEqual(
            expect.objectContaining({ text: "Hi Alice", username: "bob", senderId: USERS.bob._id })
        );
    });

    test("the sender also receives its own message (one copy) so every client shows the same list", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const aliceInbox = recordEvents(alice, "new_message");
        const bobInbox = recordEvents(bob, "new_message");

        alice.emit("message", { text: "echo check" });

        await waitUntil(() => aliceInbox.length === 1 && bobInbox.length === 1);
        expect(aliceInbox[0]).toEqual(bobInbox[0]);
        expect(aliceInbox[0].username).toBe("alice");

        // Confirm no duplicate arrives later: the next message is the next event.
        bob.emit("message", { text: "next" });
        await waitUntil(() => aliceInbox.length === 2);
        expect(aliceInbox.map((message) => message.text)).toEqual(["echo check", "next"]);
    });

    test("a back-and-forth conversation arrives in order on both clients", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const aliceInbox = recordEvents(alice, "new_message");
        const bobInbox = recordEvents(bob, "new_message");
        const conversation = [
            [alice, "Hi Bob"],
            [bob, "Hi Alice"],
            [alice, "How are you?"],
            [bob, "Good, thanks!"]
        ];

        for (const [client, text] of conversation) {
            const delivered = waitUntil(() => bobInbox.some((message) => message.text === text));
            client.emit("message", { text });
            await delivered;
        }

        await waitUntil(() => aliceInbox.length === 4);
        const expected = ["alice: Hi Bob", "bob: Hi Alice", "alice: How are you?", "bob: Good, thanks!"];
        expect(aliceInbox.map((m) => `${m.username}: ${m.text}`)).toEqual(expected);
        expect(bobInbox.map((m) => `${m.username}: ${m.text}`)).toEqual(expected);
    });

    test("rapid messages from one client keep their sending order", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const bobInbox = recordEvents(bob, "new_message");
        const texts = Array.from({ length: 20 }, (_, i) => `message ${i + 1}`);

        for (const text of texts) alice.emit("message", { text });

        await waitUntil(() => bobInbox.length === texts.length);
        expect(bobInbox.map((message) => message.text)).toEqual(texts);
    });

    test("each delivered message has been saved once with the sender and room", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");

        alice.emit("message", { text: "persist me" });
        const message = await received;

        expect(savedMessages).toEqual([
            expect.objectContaining({
                _id: message.id,
                senderId: USERS.alice._id,
                roomId: DEFAULT_ROOM,
                content: "persist me"
            })
        ]);
    });

    test("a message is delivered to the other client within 1 second (FR-007, TC-PERF-01)", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");

        const startedAt = performance.now();
        alice.emit("message", { text: "timing" });
        await received;
        const elapsed = performance.now() - startedAt;

        expect(elapsed).toBeLessThan(1000);
    });
});

describe("delivery to all connected users", () => {
    test("a message reaches every connected user in the room, including the sender", async () => {
        const clients = await Promise.all(Object.values(USERS).map(connectAs));
        const inboxes = clients.map((client) => recordEvents(client, "new_message"));

        clients[2].emit("message", { text: "hello everyone" });

        await waitUntil(() => inboxes.every((inbox) => inbox.length === 1));
        for (const inbox of inboxes) {
            expect(inbox[0]).toEqual(expect.objectContaining({ text: "hello everyone", username: "carol" }));
        }
    });

    test("messages sent by every user reach every other user", async () => {
        const clients = await Promise.all(Object.values(USERS).map(connectAs));
        const inboxes = clients.map((client) => recordEvents(client, "new_message"));

        clients.forEach((client, index) => client.emit("message", { text: `from ${index}` }));

        await waitUntil(() => inboxes.every((inbox) => inbox.length === 3));
        for (const inbox of inboxes) {
            expect(inbox.map((message) => message.text).sort()).toEqual(["from 0", "from 1", "from 2"]);
        }
    });

    test("a user who disconnected stops receiving while the others keep chatting", async () => {
        const [alice, bob, carol] = await Promise.all(Object.values(USERS).map(connectAs));
        const bobInbox = recordEvents(bob, "new_message");
        const carolInbox = recordEvents(carol, "new_message");

        carol.disconnect();
        await waitUntil(() => server.io.of("/").sockets.size === 2);

        alice.emit("message", { text: "after carol left" });

        await waitUntil(() => bobInbox.length === 1);
        expect(bobInbox[0].text).toBe("after carol left");
        expect(carolInbox).toEqual([]);
    });

    test("a client in another room does not receive messages for the shared room", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const outsider = await connectAs(USERS.carol);

        // Move the outsider out of the shared room and into "room-2".
        server.io.of("/").sockets.get(outsider.id).leave(DEFAULT_ROOM);
        const joined = waitForEvent(outsider, "chat_history");
        outsider.emit("join_room", { roomId: "room-2" });
        await joined;
        const outsiderInbox = recordEvents(outsider, "new_message");

        const delivered = waitForEvent(bob, "new_message");
        alice.emit("message", { text: "shared room only" });
        await delivered;

        // A message sent to room-2 afterwards is the first one the outsider gets.
        const roomTwo = waitForEvent(outsider, "new_message");
        outsider.emit("message", { text: "room-2 message", roomId: "room-2" });
        await expect(roomTwo).resolves.toEqual(expect.objectContaining({ text: "room-2 message", roomId: "room-2" }));
        expect(outsiderInbox.map((message) => message.text)).toEqual(["room-2 message"]);
    });
});

describe("empty-message rejection (TC-SEC-03)", () => {
    test.each([
        ["an empty string", { text: "" }],
        ["only spaces", { text: "     " }],
        ["only tabs and newlines", { text: "\n\t \r\n" }],
        ["only control characters", { text: "\u0000\u0007\u001F" }],
        ["only HTML tags", { text: "<b></b><script></script>" }],
        ["a missing text field", {}],
        ["a null text", { text: null }],
        ["a number instead of text", { text: 42 }],
        ["an object instead of text", { text: { $ne: "" } }],
        ["an array instead of text", { text: ["hello"] }],
        ["no payload at all", undefined]
    ])("rejects %s: the sender gets an error and nobody receives it", async (_label, payload) => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const aliceInbox = recordEvents(alice, "new_message");
        const bobInbox = recordEvents(bob, "new_message");
        const bobErrors = recordEvents(bob, "message_error");
        const rejection = waitForEvent(alice, "message_error");

        alice.emit("message", payload);

        await expect(rejection).resolves.toEqual({ message: "Message text is required" });
        expect(Message.create).not.toHaveBeenCalled();

        // Events on one socket arrive in order, so if the empty message had been
        // broadcast it would arrive before this valid follow-up message.
        alice.emit("message", { text: "valid follow-up" });
        await waitUntil(() => aliceInbox.length === 1 && bobInbox.length === 1);
        expect(aliceInbox.map((message) => message.text)).toEqual(["valid follow-up"]);
        expect(bobInbox.map((message) => message.text)).toEqual(["valid follow-up"]);
        expect(bobErrors).toEqual([]);
    });

    test("the connection stays usable after an empty message is rejected", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);

        const rejection = waitForEvent(alice, "message_error");
        alice.emit("message", { text: "   " });
        await rejection;

        const received = waitForEvent(bob, "new_message");
        alice.emit("message", { text: "still connected" });
        await expect(received).resolves.toEqual(expect.objectContaining({ text: "still connected" }));
        expect(alice.connected).toBe(true);
    });
});

describe("message content handling (TC-SEC-03)", () => {
    test("surrounding whitespace is trimmed before delivery", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");

        alice.emit("message", { text: "   padded message \n" });

        await expect(received).resolves.toEqual(expect.objectContaining({ text: "padded message" }));
    });

    test("HTML tags are stripped and the remaining text is delivered", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");

        alice.emit("message", { text: "<img src=x onerror=alert(1)>hi <b>there</b>" });

        await expect(received).resolves.toEqual(expect.objectContaining({ text: "hi there" }));
    });

    test("Unicode and emoji are delivered unchanged", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");
        const text = "नमस्ते 👋 — café, 你好";

        alice.emit("message", { text });

        await expect(received).resolves.toEqual(expect.objectContaining({ text }));
    });

    test(`messages longer than ${MAX_MESSAGE_LENGTH} characters are cut to the limit`, async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const received = waitForEvent(bob, "new_message");

        alice.emit("message", { text: "a".repeat(MAX_MESSAGE_LENGTH + 500) });

        const message = await received;
        expect(message.text).toHaveLength(MAX_MESSAGE_LENGTH);
    });
});

describe("delivery failures", () => {
    test("a message for a room the sender has not joined is rejected and not delivered", async () => {
        const alice = await connectAs(USERS.alice);
        const rejection = waitForEvent(alice, "message_error");

        alice.emit("message", { text: "sneaky", roomId: "private-room" });

        await expect(rejection).resolves.toEqual({ message: "Join the room before sending messages" });
        expect(Message.create).not.toHaveBeenCalled();
    });

    test("an invalid room id is rejected", async () => {
        const alice = await connectAs(USERS.alice);
        const rejection = waitForEvent(alice, "message_error");

        alice.emit("message", { text: "hello", roomId: { $ne: "" } });

        await expect(rejection).resolves.toEqual({ message: "Join the room before sending messages" });
        expect(Message.create).not.toHaveBeenCalled();
    });

    test("when saving fails the sender is told and nobody receives a broadcast", async () => {
        const alice = await connectAs(USERS.alice);
        const bob = await connectAs(USERS.bob);
        const bobInbox = recordEvents(bob, "new_message");
        Message.create.mockRejectedValueOnce(new Error("write failed"));
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

        try {
            const rejection = waitForEvent(alice, "message_error");
            alice.emit("message", { text: "lost?" });
            await expect(rejection).resolves.toEqual({ message: "Message could not be sent" });

            alice.emit("message", { text: "after failure" });
            await waitUntil(() => bobInbox.length === 1);
            expect(bobInbox.map((message) => message.text)).toEqual(["after failure"]);
        } finally {
            errorSpy.mockRestore();
        }
    });
});
