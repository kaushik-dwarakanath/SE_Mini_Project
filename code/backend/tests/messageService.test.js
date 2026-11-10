jest.mock("../models/Message");
const Message = require("../models/Message");
const { saveMessage, getHistory } = require("../services/messageService");

describe("messageService", () => {
    test("saveMessage stores and returns a DTO", async () => {
        Message.create.mockResolvedValue({
            _id: "m1", roomId: "general", content: "hi", senderId: "u1",
            createdAt: new Date("2026-01-01T00:00:00Z")
        });
        const result = await saveMessage({ senderId: "u1", username: "alice", roomId: "general", content: "hi" });
        expect(Message.create).toHaveBeenCalledWith({ senderId: "u1", roomId: "general", content: "hi" });
        expect(result).toMatchObject({ id: "m1", text: "hi", username: "alice", roomId: "general" });
    });

    test("getHistory filters by room and 'since' (TC-REL-01)", async () => {
        const chain = {
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                { _id: "m2", roomId: "general", content: "b", senderId: { _id: "u1", username: "alice" }, createdAt: new Date() },
                { _id: "m1", roomId: "general", content: "a", senderId: { _id: "u1", username: "alice" }, createdAt: new Date() }
            ])
        };
        Message.find.mockReturnValue(chain);

        const history = await getHistory("general", "2026-01-01T00:00:00Z");

        const query = Message.find.mock.calls[0][0];
        expect(query.roomId).toBe("general");
        expect(query.createdAt.$gt).toBeInstanceOf(Date);
        expect(history.map((m) => m.text)).toEqual(["a", "b"]); // oldest first
    });
});