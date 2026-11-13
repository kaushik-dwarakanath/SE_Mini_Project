// Issue #16 — Test Socket.IO connections (TC-MSG-01, TC-SEC-02, TC-SEC-04, TC-SEC-06).
// Integration tests: a real Socket.IO server (socketAuth + chat handlers) and
// real socket.io-client clients over the network. The User model and message
// service are mocked so the tests run without MongoDB.
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../models/User");
jest.mock("../services/messageService");
jest.mock("../utils/logger");

const http = require("http");
const jwt = require("jsonwebtoken");
const { io: ioClient } = require("socket.io-client");
const User = require("../models/User");
const messageService = require("../services/messageService");
const logger = require("../utils/logger");
const { signToken } = require("../services/tokenService");
const { DEFAULT_ROOM } = require("../sockets/chatHandlers");
const {
    startSocketServer,
    waitForEvent,
    waitForConnect,
    expectConnectError,
    waitUntil
} = require("./helpers/socketTestServer");

const USERS = {
    u1: { _id: "64b7f0c2a1b2c3d4e5f60001", username: "alice" },
    u2: { _id: "64b7f0c2a1b2c3d4e5f60002", username: "bob" }
};

let server;

const tokenFor = (user) => signToken(user._id);

const logCalls = (level, event) =>
    logger[level].mock.calls.filter(([name]) => name === event).map(([, meta]) => meta);

const serverSocketCount = () => server.io.of("/").sockets.size;

beforeEach(async () => {
    jest.clearAllMocks();

    // socketAuth calls User.findById(id).select("username").
    User.findById.mockImplementation((id) => ({
        select: jest.fn().mockResolvedValue(
            Object.values(USERS).find((user) => user._id === String(id)) ?? null
        )
    }));
    messageService.getHistory.mockResolvedValue([]);

    server = await startSocketServer();
});

afterEach(async () => {
    await server.close();
});

describe("successful connection (TC-MSG-01)", () => {
    test("a client with a valid token connects and is joined to the shared room", async () => {
        const client = server.connect(tokenFor(USERS.u1));
        const history = waitForEvent(client, "chat_history");

        await waitForConnect(client);

        expect(client.connected).toBe(true);
        expect(client.id).toEqual(expect.any(String));
        await expect(history).resolves.toEqual([]);
        expect(messageService.getHistory).toHaveBeenCalledWith(DEFAULT_ROOM);

        const serverSocket = server.io.of("/").sockets.get(client.id);
        expect(serverSocket.data.user).toEqual({ id: USERS.u1._id, username: "alice" });
        expect(serverSocket.rooms.has(DEFAULT_ROOM)).toBe(true);
    });

    test("the connection is recorded in the server log", async () => {
        const client = server.connect(tokenFor(USERS.u1));
        await waitForConnect(client);

        expect(logCalls("info", "SOCKET_CONNECTED")).toEqual([
            { username: "alice", socketId: client.id }
        ]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test("connects over HTTP long-polling as well as WebSocket", async () => {
        const client = server.connect(tokenFor(USERS.u1), { transports: ["polling"] });
        await waitForConnect(client);

        expect(client.io.engine.transport.name).toBe("polling");
        expect(serverSocketCount()).toBe(1);
    });

    test("upgrades from polling to WebSocket with the default transports", async () => {
        const client = server.connect(tokenFor(USERS.u1), { transports: ["polling", "websocket"] });
        await waitForConnect(client);

        await waitUntil(() => client.io.engine.transport.name === "websocket");
        expect(serverSocketCount()).toBe(1);
    });

    test("several users can be connected at the same time with separate sockets", async () => {
        const alice = server.connect(tokenFor(USERS.u1));
        const bob = server.connect(tokenFor(USERS.u2));
        const aliceAgain = server.connect(tokenFor(USERS.u1));

        await Promise.all([alice, bob, aliceAgain].map((client) => waitForConnect(client)));

        expect(new Set([alice.id, bob.id, aliceAgain.id]).size).toBe(3);
        expect(serverSocketCount()).toBe(3);
        expect(server.io.of("/").adapter.rooms.get(DEFAULT_ROOM).size).toBe(3);
    });

    test("a history loading failure is reported to the client without dropping the connection", async () => {
        messageService.getHistory.mockRejectedValue(new Error("database unavailable"));
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

        try {
            const client = server.connect(tokenFor(USERS.u1));
            const messageError = waitForEvent(client, "message_error");
            await waitForConnect(client);

            await expect(messageError).resolves.toEqual({ message: "Could not load chat history" });
            expect(client.connected).toBe(true);
        } finally {
            errorSpy.mockRestore();
        }
    });
});

describe("connection failures (TC-SEC-02, TC-SEC-04, TC-SEC-06)", () => {
    test.each([
        ["no token", undefined, "Authentication required", "missing token"],
        ["an empty token", "", "Authentication required", "missing token"],
        ["a malformed token", "not-a-jwt", "Invalid authentication token", "JsonWebTokenError"],
        [
            "a token signed with another secret",
            jwt.sign({ userId: USERS.u1._id }, "wrong-secret", { expiresIn: "1h" }),
            "Invalid authentication token",
            "JsonWebTokenError"
        ],
        [
            "an expired token",
            jwt.sign({ userId: USERS.u1._id }, "test-secret", { expiresIn: -10 }),
            "Invalid authentication token",
            "TokenExpiredError"
        ],
        [
            "a valid token for a deleted user",
            signToken("64b7f0c2a1b2c3d4e5f6ffff"),
            "User not found",
            "user not found"
        ]
    ])("rejects %s, records the failure and keeps no socket", async (_label, token, message, reason) => {
        const client = server.connect(token);

        const error = await expectConnectError(client);

        expect(error.message).toBe(message);
        expect(client.connected).toBe(false);
        expect(serverSocketCount()).toBe(0);

        const failures = logCalls("warn", "SOCKET_AUTH_FAILED");
        expect(failures).toEqual([{ reason, ip: expect.any(String) }]);
        expect(logCalls("info", "SOCKET_CONNECTED")).toEqual([]);
    });

    test("never writes the rejected token to the log", async () => {
        const token = jwt.sign({ userId: USERS.u1._id }, "wrong-secret");
        await expectConnectError(server.connect(token));

        const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.info.mock.calls]);
        expect(logged).not.toContain(token);
    });

    test("rejects the connection when the user lookup fails (database down)", async () => {
        User.findById.mockImplementation(() => ({
            select: jest.fn().mockRejectedValue(new Error("connection refused"))
        }));

        const error = await expectConnectError(server.connect(tokenFor(USERS.u1)));

        expect(error.message).toBe("Invalid authentication token");
        expect(serverSocketCount()).toBe(0);
        expect(logCalls("warn", "SOCKET_AUTH_FAILED")).toEqual([
            { reason: "Error", ip: expect.any(String) }
        ]);
    });

    test("a rejected client does not receive chat history or join the room", async () => {
        const client = server.connect("not-a-jwt");
        const history = jest.fn();
        client.on("chat_history", history);

        await expectConnectError(client);

        expect(history).not.toHaveBeenCalled();
        expect(messageService.getHistory).not.toHaveBeenCalled();
        expect(server.io.of("/").adapter.rooms.get(DEFAULT_ROOM)).toBeUndefined();
    });

    test("reports a transport error when the server is unreachable", async () => {
        // Reserve a free port, then close it so nothing is listening there.
        const probe = http.createServer();
        await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
        const { port } = probe.address();
        await new Promise((resolve) => probe.close(resolve));

        const client = ioClient(`http://127.0.0.1:${port}`, {
            auth: { token: tokenFor(USERS.u1) },
            transports: ["websocket"],
            reconnection: false,
            forceNew: true
        });

        try {
            const error = await expectConnectError(client);
            expect(error.message).toBe("websocket error");
            expect(client.connected).toBe(false);
        } finally {
            client.disconnect();
        }
    });

    test("a client can connect after a rejected attempt once it has a valid token", async () => {
        const client = server.connect("not-a-jwt");
        await expectConnectError(client);

        client.auth = { token: tokenFor(USERS.u1) };
        client.connect();
        await waitForConnect(client);

        expect(serverSocketCount()).toBe(1);
    });
});

describe("disconnection handling (TC-MSG-01, NFR-004)", () => {
    test("client logout: the server removes the socket, leaves the room and logs the reason", async () => {
        const client = server.connect(tokenFor(USERS.u1));
        await waitForConnect(client);
        const socketId = client.id;

        client.disconnect();

        await waitUntil(() => logCalls("info", "SOCKET_DISCONNECTED").length === 1);
        expect(logCalls("info", "SOCKET_DISCONNECTED")).toEqual([
            { socketId, reason: "client namespace disconnect" }
        ]);
        expect(serverSocketCount()).toBe(0);
        expect(server.io.of("/").adapter.rooms.get(DEFAULT_ROOM)).toBeUndefined();
        expect(client.connected).toBe(false);
    });

    test("server-side disconnect: the client is told the server closed the connection", async () => {
        const client = server.connect(tokenFor(USERS.u1));
        await waitForConnect(client);
        const reason = waitForEvent(client, "disconnect");

        server.io.of("/").sockets.get(client.id).disconnect(true);

        await expect(reason).resolves.toBe("io server disconnect");
        await waitUntil(() => serverSocketCount() === 0);
        expect(logCalls("info", "SOCKET_DISCONNECTED")).toEqual([
            { socketId: expect.any(String), reason: "server namespace disconnect" }
        ]);
    });

    test("one client disconnecting does not affect other connected clients", async () => {
        const alice = server.connect(tokenFor(USERS.u1));
        const bob = server.connect(tokenFor(USERS.u2));
        await Promise.all([waitForConnect(alice), waitForConnect(bob)]);

        alice.disconnect();
        await waitUntil(() => serverSocketCount() === 1);

        expect(bob.connected).toBe(true);
        expect(server.io.of("/").sockets.has(bob.id)).toBe(true);
        expect(server.io.of("/").adapter.rooms.get(DEFAULT_ROOM)).toEqual(new Set([bob.id]));
    });

    test("transport loss: the client reconnects automatically without duplicate sockets", async () => {
        const client = server.connect(tokenFor(USERS.u1), {
            reconnection: true,
            reconnectionDelay: 50,
            reconnectionDelayMax: 50
        });
        await waitForConnect(client);
        const firstId = client.id;
        const disconnected = waitForEvent(client, "disconnect");
        const reconnected = waitForEvent(client.io, "reconnect");
        const connectedAgain = waitForEvent(client, "connect");

        // Simulate a network drop: close the underlying connection without a
        // Socket.IO disconnect packet, so the client treats it as transport loss.
        server.io.of("/").sockets.get(firstId).conn.close();

        await expect(disconnected).resolves.toBe("transport close");
        await reconnected;
        await connectedAgain;

        expect(client.connected).toBe(true);
        expect(client.id).not.toBe(firstId);
        await waitUntil(() => serverSocketCount() === 1);
        expect(server.io.of("/").sockets.has(firstId)).toBe(false);
        expect(logCalls("info", "SOCKET_CONNECTED")).toHaveLength(2);
        expect(logCalls("info", "SOCKET_DISCONNECTED")).toEqual([
            { socketId: firstId, reason: "forced close" }
        ]);
    });

    test("an idle socket is disconnected when its token expires (SEC-004)", async () => {
        const shortLived = jwt.sign({ userId: USERS.u1._id }, "test-secret", { expiresIn: 2 });
        const client = server.connect(shortLived);
        const authError = waitForEvent(client, "auth_error", 4000);
        const disconnected = waitForEvent(client, "disconnect", 4000);
        await waitForConnect(client);

        await expect(authError).resolves.toEqual({ message: "Session expired. Please log in again." });
        await expect(disconnected).resolves.toBe("io server disconnect");
        expect(serverSocketCount()).toBe(0);
        expect(logCalls("warn", "SOCKET_TOKEN_EXPIRED")).toEqual([
            { userId: USERS.u1._id, socketId: expect.any(String) }
        ]);
    }, 8000);

    test("repeated connect/disconnect cycles leave no sockets behind", async () => {
        for (let cycle = 0; cycle < 5; cycle++) {
            const client = server.connect(tokenFor(USERS.u1));
            await waitForConnect(client);
            client.disconnect();
        }

        await waitUntil(() => logCalls("info", "SOCKET_DISCONNECTED").length === 5);
        expect(serverSocketCount()).toBe(0);
        expect(logCalls("info", "SOCKET_CONNECTED")).toHaveLength(5);
    });
});
