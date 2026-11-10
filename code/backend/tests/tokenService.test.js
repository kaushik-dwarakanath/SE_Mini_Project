const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret";
const { signToken, verifyToken } = require("../services/tokenService");

describe("tokenService (TC-SEC-04)", () => {
    test("signs and verifies a token", () => {
        const decoded = verifyToken(signToken("abc123"));
        expect(decoded.userId).toBe("abc123");
    });
    test("rejects expired tokens", () => {
        const expired = jwt.sign({ userId: "x" }, "test-secret", { expiresIn: -10 });
        expect(() => verifyToken(expired)).toThrow("jwt expired");
    });
    test("rejects tokens with a wrong signature", () => {
        const forged = jwt.sign({ userId: "x" }, "other-secret");
        expect(() => verifyToken(forged)).toThrow();
    });
});