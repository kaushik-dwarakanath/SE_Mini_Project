const { sanitizeMessage, isValidRoomId, MAX_MESSAGE_LENGTH } = require("../utils/sanitize");

describe("sanitizeMessage (TC-SEC-03)", () => {
    test("strips HTML tags", () => {
        expect(sanitizeMessage("<script>alert(1)</script>hi")).toBe("alert(1)hi");
        expect(sanitizeMessage("<img src=x onerror=alert(1)>ok")).toBe("ok");
    });
    test("removes control characters", () => {
        expect(sanitizeMessage("a\u0000b\u0007c")).toBe("abc");
    });
    test("trims and limits length", () => {
        expect(sanitizeMessage("   hi   ")).toBe("hi");
        expect(sanitizeMessage("x".repeat(5000))).toHaveLength(MAX_MESSAGE_LENGTH);
    });
    test("non-strings become empty", () => {
        expect(sanitizeMessage(null)).toBe("");
        expect(sanitizeMessage({ $gt: "" })).toBe("");
    });
});

describe("isValidRoomId", () => {
    test("accepts safe ids", () => expect(isValidRoomId("general-1")).toBe(true));
    test("rejects unsafe ids", () => {
        expect(isValidRoomId("")).toBe(false);
        expect(isValidRoomId("a b")).toBe(false);
        expect(isValidRoomId({ $ne: 1 })).toBe(false);
    });
});