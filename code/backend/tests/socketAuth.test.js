process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../models/User");
jest.mock("../utils/logger");

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const logger = require("../utils/logger");
const { signToken } = require("../services/tokenService");
const socketAuth = require("../sockets/socketAuth");

const makeSocket = (token) => ({
    handshake: { auth: token === undefined ? {} : { token }, address: "1.2.3.4" },
    data: {}
});

const mockFindUser = (user) =>
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

beforeEach(() => {
    jest.clearAllMocks();
});

describe("socketAuth (TC-SEC-02, TC-SEC-04, TC-SEC-06)", () => {
    test("rejects a connection with no token and logs it", async () => {
        const next = jest.fn();
        await socketAuth(makeSocket(), next);

        expect(next.mock.calls[0][0].message).toBe("Authentication required");
        expect(logger.warn).toHaveBeenCalledWith(
            "SOCKET_AUTH_FAILED",
            expect.objectContaining({ reason: "missing token", ip: "1.2.3.4" })
        );
    });

    test("rejects a garbage token and logs it", async () => {
        const next = jest.fn();
        await socketAuth(makeSocket("garbage"), next);

        expect(next.mock.calls[0][0].message).toBe("Invalid authentication token");
        expect(logger.warn).toHaveBeenCalledWith("SOCKET_AUTH_FAILED", expect.any(Object));
    });

    test("rejects an expired token", async () => {
        const expired = jwt.sign({ userId: "u1" }, "test-secret", { expiresIn: -10 });
        const next = jest.fn();
        await socketAuth(makeSocket(expired), next);

        expect(next.mock.calls[0][0].message).toBe("Invalid authentication token");
        expect(logger.warn).toHaveBeenCalledWith(
            "SOCKET_AUTH_FAILED",
            expect.objectContaining({ reason: "TokenExpiredError" })
        );
    });

    test("rejects a valid token for a user that no longer exists", async () => {
        mockFindUser(null);
        const next = jest.fn();
        await socketAuth(makeSocket(signToken("u1")), next);

        expect(next.mock.calls[0][0].message).toBe("User not found");
        expect(logger.warn).toHaveBeenCalled();
    });

    test("accepts a valid token and attaches the user and expiry", async () => {
        mockFindUser({ _id: "u1", username: "alice" });
        const socket = makeSocket(signToken("u1"));
        const next = jest.fn();
        await socketAuth(socket, next);

        expect(next).toHaveBeenCalledWith();
        expect(socket.data.user).toEqual({ id: "u1", username: "alice" });
        expect(socket.data.tokenExp).toEqual(expect.any(Number));
        expect(logger.warn).not.toHaveBeenCalled();
    });
});