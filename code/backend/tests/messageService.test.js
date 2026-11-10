jest.mock("../models/Message");
const Message = require("../models/Message");
const {
    saveMessage,
    getHistory,
    getMessagesPage,
    toDto
} = require("../services/messageService");


const makeId = (n) => n.toString(16).padStart(24, "0");
const BASE_TIME = Date.UTC(2026, 0, 1);

// 3 messages share every timestamp, to exercise same-millisecond ties.
const makeDocs = (count, roomId = "general") =>
    Array.from({ length: count }, (_, i) => ({
        _id: makeId(i + 1),
        roomId,
        content: `msg ${i}`,
        senderId: { _id: "u1", username: "alice" },
        createdAt: new Date(BASE_TIME + Math.floor(i / 3) * 1000)
    }));

const matches = (doc, cond) =>
    Object.entries(cond).every(([key, expected]) => {
        if (key === "$or") return expected.some((c) => matches(doc, c));
        if (key === "createdAt") {
            if (expected instanceof Date) return doc.createdAt.getTime() === expected.getTime();
            return doc.createdAt.getTime() > expected.$gt.getTime();
        }
        if (key === "_id") return doc._id > expected.$gt;
        return doc[key] === expected;
    });

const sortValue = (doc, key) => (key === "createdAt" ? doc.createdAt.getTime() : doc[key]);

const installFakeDb = (docs) => {
    Message.find.mockImplementation((query) => {
        let result = docs.filter((doc) => matches(doc, query));
        const chain = {
            sort: jest.fn((spec) => {
                result = [...result].sort((a, b) => {
                    for (const [key, dir] of Object.entries(spec)) {
                        const av = sortValue(a, key);
                        const bv = sortValue(b, key);
                        if (av < bv) return -1 * dir;
                        if (av > bv) return 1 * dir;
                    }
                    return 0;
                });
                return chain;
            }),
            limit: jest.fn((n) => {
                result = result.slice(0, n);
                return chain;
            }),
            populate: jest.fn(() => chain),
            lean: jest.fn(async () => result)
        };
        return chain;
    });
};

// Walks forward through all pages, the way a reconnecting client/handler does.
async function fetchAllMissed(roomId, firstOptions) {
    const messages = [];
    let options = firstOptions;
    let pages = 0;

    for (;;) {
        const page = await getMessagesPage(roomId, options);
        messages.push(...page.messages);
        pages++;
        if (!page.hasMore) break;
        options = { cursor: page.nextCursor };
        if (pages > 50) throw new Error("pagination did not terminate");
    }

    return { messages, pages };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("saveMessage", () => {
    test("stores and returns a DTO", async () => {
        Message.create.mockResolvedValue({
            _id: makeId(1), roomId: "general", content: "hi", senderId: "u1",
            createdAt: new Date("2026-01-01T00:00:00Z")
        });
        const result = await saveMessage({ senderId: "u1", username: "alice", roomId: "general", content: "hi" });
        expect(Message.create).toHaveBeenCalledWith({ senderId: "u1", roomId: "general", content: "hi" });
        expect(result).toMatchObject({ id: makeId(1), text: "hi", username: "alice", roomId: "general" });
        expect(typeof result.cursor).toBe("string");
    });
});

describe("reconnect catch-up regression (TC-REL-01, NFR-004)", () => {
    test("returns ALL missed messages when more than 100 arrived during the disconnect", async () => {
        const docs = makeDocs(250);
        installFakeDb(docs);

        // Client last saw message index 11 (last of its timestamp group).
        const since = docs[11].createdAt.toISOString();
        const expected = docs.slice(12).map((d) => d._id); // 238 missed messages

        const { messages, pages } = await fetchAllMissed("general", { since });

        expect(messages).toHaveLength(238);
        expect(messages.map((m) => m.id)).toEqual(expected); // none skipped, in order
        expect(pages).toBe(3); // 100 + 100 + 38
    });

    test("the first page holds the OLDEST missed messages, not the newest", async () => {
        const docs = makeDocs(250);
        installFakeDb(docs);

        const page = await getMessagesPage("general", { since: docs[11].createdAt.toISOString() });

        expect(page.messages).toHaveLength(100);
        expect(page.messages[0].id).toBe(docs[12]._id);
        expect(page.hasMore).toBe(true);
    });

    test("a cursor from the middle of a same-timestamp group loses and repeats nothing", async () => {
        const docs = makeDocs(250);
        installFakeDb(docs);

        // docs[10] shares its timestamp with docs[9] and docs[11].
        const lastSeen = toDto(docs[10]);
        const { messages } = await fetchAllMissed("general", { cursor: lastSeen.cursor });

        const ids = messages.map((m) => m.id);
        expect(ids).toEqual(docs.slice(11).map((d) => d._id));
        expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });

    test("a page boundary that splits a same-timestamp group loses nothing", async () => {
        const docs = makeDocs(250);
        installFakeDb(docs);

        // limit 100 ends at index 99, whose timestamp group continues at 100 and 101
        const first = await getMessagesPage("general", { limit: 100 });
        const second = await getMessagesPage("general", { cursor: first.nextCursor, limit: 100 });

        expect(first.messages[99].id).toBe(docs[99]._id);
        expect(second.messages[0].id).toBe(docs[100]._id);
    });

    test("hasMore is false when exactly one page remains", async () => {
        installFakeDb(makeDocs(100));
        const page = await getMessagesPage("general", { limit: 100 });
        expect(page.messages).toHaveLength(100);
        expect(page.hasMore).toBe(false);
    });

    test("hasMore is true when one message more than a page remains", async () => {
        installFakeDb(makeDocs(101));
        const page = await getMessagesPage("general", { limit: 100 });
        expect(page.messages).toHaveLength(100);
        expect(page.hasMore).toBe(true);
        expect(page.nextCursor).toBe(page.messages[99].cursor);
    });

    test("nothing missed gives an empty page and no cursor", async () => {
        const docs = makeDocs(5);
        installFakeDb(docs);
        const page = await getMessagesPage("general", { cursor: toDto(docs[4]).cursor });
        expect(page).toEqual({ messages: [], hasMore: false, nextCursor: null });
    });

    test("only returns messages for the requested room", async () => {
        installFakeDb([...makeDocs(5, "a"), ...makeDocs(5, "b").map((d, i) => ({ ...d, _id: makeId(100 + i) }))]);
        const page = await getMessagesPage("a", {});
        expect(page.messages).toHaveLength(5);
        expect(page.messages.every((m) => m.roomId === "a")).toBe(true);
    });

    test("rejects a malformed cursor", async () => {
        installFakeDb([]);
        await expect(getMessagesPage("general", { cursor: "not-a-cursor" }))
            .rejects.toMatchObject({ code: "INVALID_PAGINATION" });
        await expect(getMessagesPage("general", { cursor: { $gt: "" } }))
            .rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    });

    test("rejects an invalid since value instead of returning the whole history", async () => {
        installFakeDb(makeDocs(5));
        await expect(getMessagesPage("general", { since: "yesterday-ish" }))
            .rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    });
});

describe("getHistory (initial load)", () => {
    test("returns the latest 100 messages, oldest first", async () => {
        const docs = makeDocs(250);
        installFakeDb(docs);

        const history = await getHistory("general");

        expect(history).toHaveLength(100);
        expect(history.map((m) => m.id)).toEqual(docs.slice(150).map((d) => d._id));
    });
});