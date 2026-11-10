const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "security.log");

const write = (level, event, meta = {}) => {
    const entry = JSON.stringify({
        time: new Date().toISOString(),
        level,
        event,
        ...meta
    });

    console[level === "warn" ? "warn" : "log"](entry);

    if (process.env.NODE_ENV === "test") return;

    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFile(LOG_FILE, entry + "\n", () => {});
    } catch (err) {
        console.error("Logger file write failed:", err.message);
    }
};

module.exports = {
    info: (event, meta) => write("info", event, meta),
    // Use for security events (failed logins, rejected sockets, bad tokens).
    // Never pass passwords or tokens in meta.
    warn: (event, meta) => write("warn", event, meta)
};