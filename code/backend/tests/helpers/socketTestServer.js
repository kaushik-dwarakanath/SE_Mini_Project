// Shared helpers for Socket.IO integration tests.
// Starts the real Socket.IO server (createSocketServer: socketAuth + chat
// handlers) on a random local port and connects real socket.io-client clients.
// Each test file decides which modules to mock (for example the User model or
// the message service), so no MongoDB server is needed unless a test opts in.
const http = require("http");
const { io: ioClient } = require("socket.io-client");
const { createSocketServer } = require("../../sockets");

const DEFAULT_TIMEOUT_MS = 3000;

async function startSocketServer() {
    const httpServer = http.createServer();
    const io = createSocketServer(httpServer);

    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));

    const { port } = httpServer.address();
    const url = `http://127.0.0.1:${port}`;
    const clients = new Set();

    // token === undefined sends no auth.token at all.
    function connect(token, options = {}) {
        const client = ioClient(url, {
            auth: token === undefined ? {} : { token },
            transports: ["websocket"],
            reconnection: false,
            forceNew: true,
            ...options
        });
        clients.add(client);
        return client;
    }

    async function close() {
        for (const client of clients) client.disconnect();
        clients.clear();
        await new Promise((resolve) => io.close(() => resolve()));
    }

    return { io, url, port, connect, close };
}

// Resolves with the first argument of the next `event`, or rejects after a timeout.
function waitForEvent(emitter, event, timeout = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            emitter.off(event, onEvent);
            reject(new Error(`Timed out waiting for "${event}"`));
        }, timeout);

        function onEvent(value) {
            clearTimeout(timer);
            resolve(value);
        }

        emitter.once(event, onEvent);
    });
}

// Resolves when the client connects; rejects with the connect_error otherwise.
function waitForConnect(client, timeout = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for connect"));
        }, timeout);

        function cleanup() {
            clearTimeout(timer);
            client.off("connect", onConnect);
            client.off("connect_error", onError);
        }

        function onConnect() {
            cleanup();
            resolve(client);
        }

        function onError(error) {
            cleanup();
            reject(error);
        }

        client.on("connect", onConnect);
        client.on("connect_error", onError);
    });
}

// Resolves with the connect_error of a client that is expected to be rejected.
async function expectConnectError(client, timeout = DEFAULT_TIMEOUT_MS) {
    try {
        await waitForConnect(client, timeout);
    } catch (error) {
        return error;
    }
    throw new Error("Expected the connection to be rejected, but it succeeded");
}

// Polls `check` until it returns a truthy value (useful for server-side effects).
async function waitUntil(check, timeout = DEFAULT_TIMEOUT_MS, interval = 10) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const result = check();
        if (result) return result;
        if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}

// Collects every payload of `event` so tests can assert on absence or order.
function recordEvents(emitter, event) {
    const received = [];
    emitter.on(event, (value) => received.push(value));
    return received;
}

module.exports = {
    startSocketServer,
    waitForEvent,
    waitForConnect,
    expectConnectError,
    waitUntil,
    recordEvents,
    DEFAULT_TIMEOUT_MS
};
