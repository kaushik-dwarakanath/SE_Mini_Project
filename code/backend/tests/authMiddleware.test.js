process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../utils/logger");
const logger = require("../utils/logger");
const { signToken } = require("../services/tokenService");
const authMiddleware = require("../middleware/authMiddleware");

const mockRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

describe("authMiddleware (TC-SEC-04)", () => {
    test("rejects a missing token and logs it", () => {
        const res = mockRes();
        const next = jest.fn();
        authMiddleware({ headers: {}, ip: "1.1.1.1" }, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });
    test("rejects an invalid token", () => {
        const res = mockRes();
        const next = jest.fn();
        authMiddleware({ headers: { authorization: "Bearer garbage" }, ip: "1.1.1.1" }, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
    test("accepts a valid token", () => {
        const req = { headers: { authorization: `Bearer ${signToken("u1")}` } };
        const next = jest.fn();
        authMiddleware(req, mockRes(), next);
        expect(next).toHaveBeenCalled();
        expect(req.user.id).toBe("u1");
    });
});