// TC-SEC-07 (SEC-002, SEC-004): authenticate local transport paths.
// A real HTTP server with the real Socket.IO server and real socket.io-client
// clients, over polling-only and over the default polling-then-WebSocket upgrade.
// Only the User model, the message service and the logger are mocked.
// The Vite proxy leg of the case is manual: run frontend and backend and repeat
// the connection with valid and invalid tokens through the browser.
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../models/User");
jest.mock("../services/messageService");
jest.mock("../utils/logger");

const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { Server } = require("socket.io");
const { io: connectClient } = require("socket.io-client");

const User = require("../models/User");
const messageService = require("../services/messageService");
const socketAuth = require("../sockets/socketAuth");
const { registerChatHandlers } = require("../sockets/chatHandlers");
const messageRoutes = require("../routes/messages");
const { signToken } = require("../services/tokenService");

let httpServer;
let io;
let baseUrl;
const requestUrls = [];
const clients = [];

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/messages", messageRoutes);

    httpServer = http.createServer(app);
    io = new Server(httpServer);
    io.use(socketAuth);
    io.on("connection", (socket) => registerChatHandlers(io, socket));

    // record every URL the server receives (polling requests and the upgrade)
    httpServer.prependListener("request", (req) => requestUrls.push(req.url));
    httpServer.on("upgrade", (req) => requestUrls.push(req.url));

    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

afterAll(async () => {
    clients.forEach((client) => client.close());
    await new Promise((resolve) => io.close(resolve));
});

beforeEach(() => {
    requestUrls.length = 0;
    messageService.getHistory.mockResolvedValue([]);
    User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: "u1", username: "alice" })
    });
});

afterEach(() => {
    clients.splice(0).forEach((client) => client.close());
});

const waitUntil = async (predicate, timeoutMs = 3000) => {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

// Resolves once the client either connects or is rejected.
const connect = ({ transports, auth }) =>
    new Promise((resolve) => {
        const client = connectClient(baseUrl, {
            forceNew: true,
            reconnection: false,
            auth,
            ...(transports && { transports })
        });
        clients.push(client);

        const state = { client, connected: false, error: null, historyEvents: 0 };
        client.on("chat_history", () => { state.historyEvents += 1; });
        client.on("connect", () => { state.connected = true; resolve(state); });
        client.on("connect_error", (error) => { state.error = error; resolve(state); });
    });

const TRANSPORTS = [
    ["polling only", ["polling"]],
    ["default transports (polling, then WebSocket upgrade)", undefined]
];

describe.each(TRANSPORTS)("Socket.IO JWT checks: %s", (_label, transports) => {
    test("a valid token connects and receives history only after verification", async () => {
        const state = await connect({ transports, auth: { token: signToken("u1") } });

        expect(state.connected).toBe(true);
        await waitUntil(() => state.historyEvents > 0);
        expect(User.findById).toHaveBeenCalledWith("u1");
    });

    test.each([
        ["no token", () => ({}), "Authentication required"],
        ["a malformed token", () => ({ token: "garbage" }), "Invalid authentication token"],
        [
            "a wrong-secret token",
            () => ({ token: jwt.sign({ userId: "u1" }, "attacker-secret") }),
            "Invalid authentication token"
        ],
        [
            "an expired token",
            () => ({ token: jwt.sign({ userId: "u1" }, "test-secret", { expiresIn: -10 }) }),
            "Invalid authentication token"
        ]
    ])("rejects %s with no history and no room membership", async (_name, makeAuth, message) => {
        const state = await connect({ transports, auth: makeAuth() });

        expect(state.connected).toBe(false);
        expect(state.error.message).toBe(message);

        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(state.historyEvents).toBe(0);
    });

    test("rejects a valid token for a deleted user", async () => {
        User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

        const state = await connect({ transports, auth: { token: signToken("u1") } });

        expect(state.connected).toBe(false);
        expect(state.error.message).toBe("User not found");
        expect(state.historyEvents).toBe(0);
    });
});

describe("transport behaviour", () => {
    test("polling-only connections stay on polling", async () => {
        const state = await connect({ transports: ["polling"], auth: { token: signToken("u1") } });

        expect(state.connected).toBe(true);
        expect(state.client.io.engine.transport.name).toBe("polling");
    });

    test("the default transport upgrades to WebSocket", async () => {
        const state = await connect({ auth: { token: signToken("u1") } });

        expect(state.connected).toBe(true);
        await waitUntil(() => state.client.io.engine.transport.name === "websocket", 5000);
    });

    test("the token travels in the handshake auth object, never in a URL or query string", async () => {
        const token = signToken("u1");

        await connect({ transports: ["polling"], auth: { token } });
        const upgraded = await connect({ auth: { token } });
        await waitUntil(() => upgraded.client.io.engine.transport.name === "websocket", 5000);

        expect(requestUrls.length).toBeGreaterThan(0);
        for (const url of requestUrls) {
            expect(url).not.toContain(token);
            expect(new URL(url, baseUrl).searchParams.has("token")).toBe(false);
        }
    });

    test("the local service runs over plain HTTP (HTTPS/WSS is not asserted)", () => {
        expect(baseUrl.startsWith("http://")).toBe(true);
        expect(httpServer).toBeInstanceOf(http.Server);
    });
});

describe("REST JWT checks use the Authorization: Bearer header", () => {
    test("401 without an Authorization header", async () => {
        const res = await request(httpServer).get("/api/messages/general");
        expect(res.status).toBe(401);
    });

    test("200 with a valid Bearer token", async () => {
        const res = await request(httpServer)
            .get("/api/messages/general")
            .set("Authorization", `Bearer ${signToken("u1")}`);
        expect(res.status).toBe(200);
    });

    test.each([
        ["a malformed", () => "garbage"],
        ["a wrong-secret", () => jwt.sign({ userId: "u1" }, "attacker-secret")],
        ["an expired", () => jwt.sign({ userId: "u1" }, "test-secret", { expiresIn: -10 })]
    ])("401 with %s Bearer token", async (_name, makeToken) => {
        const res = await request(httpServer)
            .get("/api/messages/general")
            .set("Authorization", `Bearer ${makeToken()}`);
        expect(res.status).toBe(401);
    });

    test.each(["token", "access_token"])(
        "a valid token in the ?%s query string is not accepted",
        async (param) => {
            const res = await request(httpServer).get(`/api/messages/general?${param}=${signToken("u1")}`);
            expect(res.status).toBe(401);
        }
    );
});