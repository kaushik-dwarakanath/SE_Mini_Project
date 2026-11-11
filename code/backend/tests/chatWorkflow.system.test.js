// Issue #18 — Test the basic chat application workflow
// (TC-AUTH-01, TC-AUTH-03, TC-ROOM-01, TC-MSG-02, TC-HIST-01, TC-UX-01).
// System test: the real Express app and Socket.IO server on one HTTP server,
// backed by a real (in-memory) MongoDB. Nothing in the application is mocked.
// The steps run in order and share state, like a user going through the app:
// register -> log in -> join the shared room -> exchange messages -> history.
process.env.JWT_SECRET = "workflow-test-secret";
process.env.NODE_ENV = "test";

const http = require("http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { io: ioClient } = require("socket.io-client");
const { createApp } = require("../app");
const { createSocketServer } = require("../sockets");
const User = require("../models/User");
const Message = require("../models/Message");
const { DEFAULT_ROOM } = require("../sockets/chatHandlers");
const { waitForEvent, waitForConnect, expectConnectError, waitUntil, recordEvents } = require("./helpers/socketTestServer");

jest.setTimeout(30000);

const ALICE = { username: "alice", email: "alice@example.com", password: "alice-password-1" };
const BOB = { username: "bob", email: "Bob@Example.com", password: "bob-password-12" };

let mongo;
let httpServer;
let io;
let baseUrl;
const clients = new Set();
const session = {};

async function post(path, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}

async function get(path, token) {
    const response = await fetch(`${baseUrl}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    return { status: response.status, body: await response.json() };
}

function connect(token) {
    const client = ioClient(baseUrl, {
        auth: token === undefined ? {} : { token },
        transports: ["websocket"],
        reconnection: false,
        forceNew: true
    });
    clients.add(client);
    return client;
}

// Logs in to the chat room like the browser does: connect with the JWT and
// wait for the initial history of the shared room.
async function joinChat(token) {
    const client = connect(token);
    const history = waitForEvent(client, "chat_history");
    await waitForConnect(client);
    return { client, history: await history };
}

beforeAll(async () => {
    // Keep the security logger's console output out of the test report.
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    mongo = await MongoMemoryServer.create();
    // The MongoDB driver loads the "os" module with a dynamic import(), which
    // Jest's module sandbox does not allow; the handshake then fails with
    // "Missing required sub-document 'driver'". Passing the module in directly
    // avoids that. Only this test needs it; server.js connects normally.
    await mongoose.connect(mongo.getUri("simplechat-workflow"), {
        runtimeAdapters: { os: require("os") }
    });
    await User.init(); // build the unique indexes on username and email

    httpServer = http.createServer(createApp());
    io = createSocketServer(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

afterAll(async () => {
    for (const client of clients) client.disconnect();
    if (io) await new Promise((resolve) => io.close(() => resolve()));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
    jest.restoreAllMocks();
});

describe("basic chat workflow: registration to message exchange", () => {
    test("1. the backend is up", async () => {
        const health = await get("/api/health");

        expect(health).toEqual({ status: 200, body: { status: "OK", message: "Backend server is running" } });
    });

    test("2. two users register (TC-AUTH-01)", async () => {
        const alice = await post("/register", ALICE);
        const bob = await post("/register", BOB);

        expect(alice.status).toBe(201);
        expect(alice.body.user).toEqual(expect.objectContaining({ username: "alice", email: "alice@example.com" }));
        expect(bob.status).toBe(201);
        expect(bob.body.user.email).toBe("bob@example.com");

        const stored = await User.findOne({ username: "alice" }).select("+password").lean();
        expect(stored.password).not.toBe(ALICE.password);
        expect(stored.password).toMatch(/^\$2[aby]\$12\$/);
    });

    test("3. a duplicate registration is refused", async () => {
        const duplicate = await post("/register", { ...ALICE, email: "other@example.com" });

        expect(duplicate.status).toBe(409);
        expect(await User.countDocuments()).toBe(2);
    });

    test("4. a wrong password is refused and gives no token", async () => {
        const failed = await post("/login", { identifier: "alice", password: "wrong-password" });

        expect(failed.status).toBe(401);
        expect(failed.body).toEqual({ message: "Invalid username/email or password" });
        expect(failed.body.token).toBeUndefined();
    });

    test("5. both users log in with their registered accounts (TC-AUTH-03)", async () => {
        // Alice uses her username; Bob uses his email in a different case.
        const alice = await post("/login", { identifier: "alice", password: ALICE.password });
        const bob = await post("/login", { identifier: "BOB@example.com", password: BOB.password });

        expect(alice.status).toBe(200);
        expect(alice.body.token).toEqual(expect.any(String));
        expect(alice.body.user.username).toBe("alice");
        expect(bob.status).toBe(200);
        expect(bob.body.user.username).toBe("bob");

        session.aliceToken = alice.body.token;
        session.bobToken = bob.body.token;
    });

    test("6. without a login token the chat room cannot be joined (SEC-002)", async () => {
        const error = await expectConnectError(connect());

        expect(error.message).toBe("Authentication required");
    });

    test("7. both users join the shared chat room and see an empty history (TC-ROOM-01)", async () => {
        const alice = await joinChat(session.aliceToken);
        const bob = await joinChat(session.bobToken);

        expect(alice.history).toEqual([]);
        expect(bob.history).toEqual([]);
        expect(io.of("/").adapter.rooms.get(DEFAULT_ROOM)).toEqual(new Set([alice.client.id, bob.client.id]));

        session.alice = alice.client;
        session.bob = bob.client;
    });

    test("8. alice sends a message and bob receives it (TC-MSG-02)", async () => {
        const received = waitForEvent(session.bob, "new_message");

        session.alice.emit("message", { text: "Hi Bob, can you see this?" });

        const message = await received;
        expect(message).toEqual(expect.objectContaining({
            roomId: DEFAULT_ROOM,
            username: "alice",
            text: "Hi Bob, can you see this?"
        }));
    });

    test("9. bob replies and alice receives it", async () => {
        const received = waitForEvent(session.alice, "new_message");

        session.bob.emit("message", { text: "Yes! Loud and clear." });

        await expect(received).resolves.toEqual(expect.objectContaining({
            username: "bob",
            text: "Yes! Loud and clear."
        }));
    });

    test("10. an empty message is rejected during the conversation", async () => {
        const rejection = waitForEvent(session.alice, "message_error");

        session.alice.emit("message", { text: "   " });

        await expect(rejection).resolves.toEqual({ message: "Message text is required" });
        expect(await Message.countDocuments()).toBe(2);
    });

    test("11. the conversation is stored in MongoDB with sender, room and time (TC-HIST-01)", async () => {
        const stored = await Message.find().sort({ createdAt: 1, _id: 1 }).populate("senderId", "username").lean();

        expect(stored.map((m) => [m.senderId.username, m.roomId, m.content])).toEqual([
            ["alice", DEFAULT_ROOM, "Hi Bob, can you see this?"],
            ["bob", DEFAULT_ROOM, "Yes! Loud and clear."]
        ]);
        for (const message of stored) expect(message.createdAt).toBeInstanceOf(Date);
    });

    test("12. the message history API returns the conversation to a logged-in user", async () => {
        const unauthorized = await get(`/api/messages/${DEFAULT_ROOM}`);
        const history = await get(`/api/messages/${DEFAULT_ROOM}`, session.bobToken);

        expect(unauthorized.status).toBe(401);
        expect(history.status).toBe(200);
        expect(history.body.messages.map((m) => `${m.username}: ${m.text}`)).toEqual([
            "alice: Hi Bob, can you see this?",
            "bob: Yes! Loud and clear."
        ]);
    });

    test("13. after logging out and in again, alice gets the earlier messages", async () => {
        session.alice.disconnect();
        await waitUntil(() => io.of("/").sockets.size === 1);

        const relogin = await post("/login", { identifier: "alice@example.com", password: ALICE.password });
        expect(relogin.status).toBe(200);

        const alice = await joinChat(relogin.body.token);
        expect(alice.history.map((m) => `${m.username}: ${m.text}`)).toEqual([
            "alice: Hi Bob, can you see this?",
            "bob: Yes! Loud and clear."
        ]);
        session.alice = alice.client;
    });

    test("14. messaging still works in both directions after the reconnect", async () => {
        const aliceInbox = recordEvents(session.alice, "new_message");
        const bobInbox = recordEvents(session.bob, "new_message");

        session.bob.emit("message", { text: "Welcome back" });
        await waitUntil(() => aliceInbox.length === 1 && bobInbox.length === 1);
        session.alice.emit("message", { text: "Thanks!" });
        await waitUntil(() => aliceInbox.length === 2 && bobInbox.length === 2);

        const expected = ["bob: Welcome back", "alice: Thanks!"];
        expect(aliceInbox.map((m) => `${m.username}: ${m.text}`)).toEqual(expected);
        expect(bobInbox.map((m) => `${m.username}: ${m.text}`)).toEqual(expected);
        expect(await Message.countDocuments()).toBe(4);
    });
});
