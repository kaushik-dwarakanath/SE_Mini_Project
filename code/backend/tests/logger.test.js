process.env.NODE_ENV = "test";

const logger = require("../utils/logger");

describe("logger (TC-SEC-06)", () => {
    let warnSpy;
    let logSpy;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("warn writes a structured JSON entry with time, level and event", () => {
        logger.warn("LOGIN_FAILED", { identifier: "alice", ip: "1.2.3.4" });

        const entry = JSON.parse(warnSpy.mock.calls[0][0]);
        expect(entry).toMatchObject({
            level: "warn",
            event: "LOGIN_FAILED",
            identifier: "alice",
            ip: "1.2.3.4"
        });
        expect(new Date(entry.time).toString()).not.toBe("Invalid Date");
    });

    test("info writes a structured entry", () => {
        logger.info("SOCKET_CONNECTED", { username: "alice" });

        const entry = JSON.parse(logSpy.mock.calls[0][0]);
        expect(entry).toMatchObject({ level: "info", event: "SOCKET_CONNECTED" });
    });
});