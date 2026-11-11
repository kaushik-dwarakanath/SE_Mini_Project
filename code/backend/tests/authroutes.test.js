const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../models/User");
jest.mock("bcryptjs");
jest.mock("../utils/logger");

const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const logger = require("../utils/logger");
const authRoutes = require("../routes/auth");

const app = express();
app.use(express.json());
app.use("/", authRoutes);

const storedUser = {
    _id: "u1",
    username: "alice",
    email: "alice@example.com",
    password: "HASHED_VALUE"
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe("POST /register (TC-SEC-04, NFR-003)", () => {
    test("201 returns a token and never the password", async () => {
        User.findOne.mockResolvedValue(null);
        bcrypt.hash.mockResolvedValue("HASHED_VALUE");
        User.create.mockResolvedValue(storedUser);

        const res = await request(app)
            .post("/register")
            .send({ username: "alice", email: "Alice@Example.com", password: "password123" });

        expect(res.status).toBe(201);
        expect(res.body.token).toEqual(expect.any(String));
        expect(JSON.stringify(res.body)).not.toContain("HASHED_VALUE");
        expect(User.create).toHaveBeenCalledWith(
            expect.objectContaining({ email: "alice@example.com", password: "HASHED_VALUE" })
        );
    });

    test("400 for a password shorter than 8 characters", async () => {
        const res = await request(app)
            .post("/register")
            .send({ username: "alice", email: "a@b.com", password: "short" });

        expect(res.status).toBe(400);
        expect(User.create).not.toHaveBeenCalled();
    });

    test("400 when fields are not strings (NoSQL injection attempt)", async () => {
        const res = await request(app)
            .post("/register")
            .send({ username: { $gt: "" }, email: "a@b.com", password: "password123" });

        expect(res.status).toBe(400);
        expect(User.findOne).not.toHaveBeenCalled();
    });

    test("409 when the user already exists", async () => {
        User.findOne.mockResolvedValue(storedUser);

        const res = await request(app)
            .post("/register")
            .send({ username: "alice", email: "a@b.com", password: "password123" });

        expect(res.status).toBe(409);
    });

    test("409 on a duplicate key race (Mongo error 11000)", async () => {
        User.findOne.mockResolvedValue(null);
        bcrypt.hash.mockResolvedValue("HASHED_VALUE");
        User.create.mockRejectedValue({ code: 11000 });

        const res = await request(app)
            .post("/register")
            .send({ username: "alice", email: "a@b.com", password: "password123" });

        expect(res.status).toBe(409);
    });
});

describe("POST /login (TC-SEC-04, TC-SEC-06)", () => {
    const mockFindUser = (user) =>
        User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    test("200 returns a token and never the password hash", async () => {
        mockFindUser(storedUser);
        bcrypt.compare.mockResolvedValue(true);

        const res = await request(app)
            .post("/login")
            .send({ identifier: "alice", password: "password123" });

        expect(res.status).toBe(200);
        expect(res.body.token).toEqual(expect.any(String));
        expect(JSON.stringify(res.body)).not.toContain("HASHED_VALUE");
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test("401 and a log entry for an unknown user", async () => {
        mockFindUser(null);

        const res = await request(app)
            .post("/login")
            .send({ identifier: "ghost", password: "password123" });

        expect(res.status).toBe(401);
        expect(logger.warn).toHaveBeenCalledWith(
            "LOGIN_FAILED",
            expect.objectContaining({ reason: "unknown user", identifier: "ghost" })
        );
    });

    test("401 and a log entry for a wrong password", async () => {
        mockFindUser(storedUser);
        bcrypt.compare.mockResolvedValue(false);

        const res = await request(app)
            .post("/login")
            .send({ identifier: "alice", password: "wrongpass" });

        expect(res.status).toBe(401);
        expect(logger.warn).toHaveBeenCalledWith(
            "LOGIN_FAILED",
            expect.objectContaining({ reason: "bad password" })
        );
    });

    test("unknown user and wrong password give the same message (no user enumeration)", async () => {
        mockFindUser(null);
        const unknown = await request(app).post("/login").send({ identifier: "ghost", password: "x12345678" });

        mockFindUser(storedUser);
        bcrypt.compare.mockResolvedValue(false);
        const wrong = await request(app).post("/login").send({ identifier: "alice", password: "x12345678" });

        expect(unknown.body.message).toBe(wrong.body.message);
    });

    test("the password is never written to the log", async () => {
        mockFindUser(storedUser);
        bcrypt.compare.mockResolvedValue(false);

        await request(app).post("/login").send({ identifier: "alice", password: "SuperSecret99" });

        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SuperSecret99");
    });

    test("400 for a NoSQL operator in the password field", async () => {
        const res = await request(app)
            .post("/login")
            .send({ identifier: "alice", password: { $ne: "" } });

        expect(res.status).toBe(400);
        expect(User.findOne).not.toHaveBeenCalled();
    });

    test("400 for a NoSQL operator in the identifier field", async () => {
        const res = await request(app)
            .post("/login")
            .send({ identifier: { $gt: "" }, password: "password123" });

        expect(res.status).toBe(400);
        expect(User.findOne).not.toHaveBeenCalled();
    });
});

describe("GET /api/auth/me (authenticated profile)", () => {
    const profileUser = {
        username: "alice",
        email: "alice@example.com"
    };

    const createToken = (options = {}) =>
        jwt.sign({ userId: "u1" }, process.env.JWT_SECRET, options);

    const mockProfileLookup = (user) => {
        const lean = jest.fn().mockResolvedValue(user);
        const select = jest.fn().mockReturnValue({ lean });

        User.findById.mockReturnValue({ select });

        return { select, lean };
    };

    test("200 returns the exact authenticated user profile without password", async () => {
        mockProfileLookup(profileUser);
        const token = createToken({ expiresIn: "1h" });

        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            user: {
                username: "alice",
                email: "alice@example.com"
            }
        });
        expect(res.body.user).not.toHaveProperty("password");
        expect(User.findById).toHaveBeenCalledWith("u1");
    });

    test("401 when the authentication token is missing", async () => {
        const res = await request(app)
            .get("/api/auth/me");

        expect(res.status).toBe(401);
    });

    test("401 when the authentication token is invalid", async () => {
        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", "Bearer invalid-token");

        expect(res.status).toBe(401);
    });

    test("401 when the authentication token has expired", async () => {
        const token = createToken({ expiresIn: -1 });

        const res = await request(app)
            .get("/api/auth/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(401);
    });
});
