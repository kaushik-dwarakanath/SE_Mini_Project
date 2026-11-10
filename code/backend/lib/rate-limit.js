// Bounded fixed-window limits for a single server. A cluster needs a shared store.
function createLimiter({ limit, windowMs, maxKeys = 10000 }) {
    const entries = new Map();
    return (key) => {
        const now = Date.now();
        let entry = entries.get(key);
        if (!entry || entry.until <= now) {
            if (entries.size >= maxKeys) {
                for (const [id, value] of entries) if (value.until <= now) entries.delete(id);
                if (entries.size >= maxKeys && !entry) return false;
            }
            entry = { count: 0, until: now + windowMs };
            entries.set(key, entry);
        }
        entry.count += 1;
        return entry.count <= limit;
    };
}
module.exports = { createLimiter };
