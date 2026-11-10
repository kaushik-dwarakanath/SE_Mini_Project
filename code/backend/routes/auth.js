const express = require('express');
const bcrypt = require('bcryptjs');
const { createHmac } = require('node:crypto');
const User = require('../models/User');
const Session = require('../models/Session');
const { check, base64, validateEncryption } = require('../lib/validation');
const { createLimiter } = require('../lib/rate-limit');

const publicUser = (user) => ({ id: String(user._id), username: user.username, publicKey: user.encryption?.publicKey });
// Spend the same bcrypt work for unknown accounts as for incorrect passwords.
const dummyHash = bcrypt.hashSync('not-an-account-secret', 12);
function createAuthRoutes({ sessions, privacy, io, secret, authLimit = 60 }) {
    const router = express.Router();
    const allowed = createLimiter({ limit: authLimit, windowMs: 15 * 60 * 1000 });
    const findUser = (identifier) => {
        check(typeof identifier === 'string' && identifier.trim().length > 0 && identifier.length <= 254, 'Username or email is required');
        const value = identifier.trim();
        return User.findOne(value.includes('@') ? { emailLookup: privacy.emailLookup(value) } : { username: value });
    };
    router.use((req, res, next) => {
        if (req.method === 'POST' && !allowed(req.ip)) {
            res.set('Retry-After', '900');
            return res.status(429).json({ message: 'Too many attempts. Try again in 15 minutes.' });
        }
        next();
    });
    router.post('/register', async (req, res) => {
        const { username, email, authKey, encryption } = req.body ?? {};
        check(typeof username === 'string' && /^[A-Za-z0-9_]{3,32}$/.test(username), 'Use 3–32 letters, numbers or underscores for your username');
        check(typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), 'Enter a valid email');
        check(base64(authKey, 32), 'Invalid login credentials');
        const vault = validateEncryption(encryption);
        check(!await User.exists({ $or: [{ username }, { emailLookup: privacy.emailLookup(email) }] }), 'Username or email already exists', 409);
        const user = await User.create({ username, ...privacy.protectEmail(email), password: await bcrypt.hash(authKey, 12), encryption: vault });
        res.status(201).json({ user: publicUser(user) });
    });
    router.post('/parameters', async (req, res) => {
        const user = await findUser(req.body?.identifier).select('+encryption');
        // A stable fake salt avoids disclosing whether a modern account exists.
        const salt = user?.encryption?.salt ?? createHmac('sha256', secret).update(`unknown:${req.body.identifier.trim()}`).digest().subarray(0, 16).toString('base64');
        res.json({ salt, legacy: Boolean(user && !user.encryption), version: 1 });
    });
    router.post('/login', async (req, res) => {
        const user = await findUser(req.body?.identifier).select('+password +encryption');
        const legacy = user && !user.encryption;
        const credential = legacy ? req.body?.password : req.body?.authKey;
        const valid = typeof credential === 'string' && credential.length > 0 && credential.length <= 1024;
        const matches = await bcrypt.compare(valid ? credential : '', user?.password ?? dummyHash);
        check(valid && user && matches && (legacy || base64(credential, 32)), 'Invalid username/email or password', 401);
        res.json({ ...await sessions.issue(user), user: publicUser(user), encryption: user.encryption ?? null });
    });
    router.post('/encryption', sessions.requireAuth, async (req, res) => {
        check(!req.auth.user.encryption, 'Encryption is already configured. Log in again.', 409);
        check(base64(req.body?.authKey, 32), 'Invalid login credentials');
        const encryption = validateEncryption(req.body.encryption);
        const user = await User.findOneAndUpdate({ _id: req.auth.user._id, encryption: { $exists: false } }, {
            $set: { password: await bcrypt.hash(req.body.authKey, 12), encryption },
        }, { returnDocument: 'after' }).select('+encryption');
        check(user, 'Encryption was configured on another device. Log in again.', 409);
        // Revoke legacy sessions after changing credentials, including this one.
        await Session.deleteMany({ userId: user._id });
        io.in(`user:${user._id}`).disconnectSockets(true);
        res.json({ ...await sessions.issue(user), user: publicUser(user), encryption });
    });
    router.delete('/session', sessions.requireAuth, async (req, res) => {
        await Session.deleteOne({ tokenHash: req.auth.tokenHash });
        io.in(`session:${req.auth.tokenHash}`).disconnectSockets(true);
        res.status(204).end();
    });
    return router;
}
module.exports = { createAuthRoutes, publicUser };
