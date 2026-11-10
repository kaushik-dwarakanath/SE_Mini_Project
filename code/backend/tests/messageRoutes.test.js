process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../services/messageService");
jest.mock("../utils/logger");

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const messageService = require("../services/messageService");
const { signToken } = require("../services/tokenService");
const messageRoutes = require("../routes/messages");

const app = express();
app.use(express.json());
app.use("/api/messages", messageRoutes);

beforeEach(() => {
    jest.clearAllMocks();
    messageService.getHistory.mockResolvedValue([{ id: "m1", text: "hi" }]);
});

describe("GET /api/messages/:roomId (TC-SEC-04)", () => {
    test("401 without a token", async () => {
        const res = await request(app).get("/api/messages/general");
        expect(res.status).toBe(401);
        expect(messageService.getHistory).not.toHaveBeenCalled();
    });

    test("401 with a garbage token", async () => {
        const res = await request(app)
            .get("/api/messages/general")
            .set("Authorization", "Bearer not-a-real-token");
        expect(res.status).toBe(401);
    });

    test("401 with an expired token", async () => {
        const expired = jwt.sign({ userId: "u1" }, "test-secret", { expiresIn: -10 });
        const res = await request(app)
            .get("/api/messages/general")
            .set("Authorization", `Bearer ${expired}`);
        expect(res.status).toBe(401);
    });

    test("401 with a token signed using the wrong secret", async () => {
        const forged = jwt.sign({ userId: "u1" }, "attacker-secret");
        const res = await request(app)
            .get("/api/messages/general")
            .set("Authorization", `Bearer ${forged}`);
        expect(res.status).toBe(401);
    });

    test("200 with a valid token", async () => {
        const res = await request(app)
            .get("/api/messages/general")
            .set("Authorization", `Bearer ${signToken("u1")}`);
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(1);
    });

    test("400 for an invalid room id", async () => {
        const res = await request(app)
            .get("/api/messages/bad.room")
            .set("Authorization", `Bearer ${signToken("u1")}`);
        expect(res.status).toBe(400);
        expect(messageService.getHistory).not.toHaveBeenCalled();
    });
});