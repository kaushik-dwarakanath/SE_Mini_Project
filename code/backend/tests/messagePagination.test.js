process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../services/messageService");
jest.mock("../utils/logger");

const request = require("supertest");
const express = require("express");
const messageService = require("../services/messageService");
const { signToken } = require("../services/tokenService");
const messageRoutes = require("../routes/messages");

const app = express();
app.use(express.json());
app.use("/api/messages", messageRoutes);

const auth = () => ({ Authorization: `Bearer ${signToken("u1")}` });

beforeEach(() => {
    jest.clearAllMocks();
});

describe("GET /api/messages/:roomId pagination (TC-REL-01)", () => {
    test("?since= returns a page with hasMore and nextCursor", async () => {
        messageService.getMessagesPage.mockResolvedValue({
            messages: [{ id: "m1" }], hasMore: true, nextCursor: "abc"
        });

        const res = await request(app)
            .get("/api/messages/general?since=2026-01-01T00:00:00Z")
            .set(auth());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ messages: [{ id: "m1" }], hasMore: true, nextCursor: "abc" });
        expect(messageService.getMessagesPage).toHaveBeenCalledWith(
            "general",
            { since: "2026-01-01T00:00:00Z", cursor: undefined, limit: undefined }
        );
    });

    test("?cursor= and ?limit= are passed to the service", async () => {
        messageService.getMessagesPage.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null });

        await request(app).get("/api/messages/general?cursor=abc&limit=50").set(auth());

        expect(messageService.getMessagesPage).toHaveBeenCalledWith(
            "general",
            { since: undefined, cursor: "abc", limit: 50 }
        );
    });

    test("an invalid cursor gives 400", async () => {
        const err = new Error("Invalid cursor");
        err.code = "INVALID_PAGINATION";
        messageService.getMessagesPage.mockRejectedValue(err);

        const res = await request(app).get("/api/messages/general?cursor=garbage").set(auth());

        expect(res.status).toBe(400);
    });

    test("no query returns the latest history", async () => {
        messageService.getHistory.mockResolvedValue([{ id: "m1" }]);

        const res = await request(app).get("/api/messages/general").set(auth());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ messages: [{ id: "m1" }] });
        expect(messageService.getMessagesPage).not.toHaveBeenCalled();
    });
});