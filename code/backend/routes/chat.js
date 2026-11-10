const express = require('express');
const User = require('../models/User');
const Message = require('../models/Message');
const { check, isId, validateMessage } = require('../lib/validation');
const { publicUser } = require('./auth');
const { createLimiter } = require('../lib/rate-limit');

const conversationId = (first, second) => [String(first), String(second)].sort().join(':');
const serializeMessage = (message) => ({
    id: String(message._id), clientId: message.clientId, version: message.version,
    senderId: String(message.senderId), recipientId: String(message.recipientId),
    ciphertext: message.ciphertext, iv: message.iv, createdAt: message.createdAt,
});
function createChatRoutes({ sessions, io }) {
    const router = express.Router();
    const maySend = createLimiter({ limit: 120, windowMs: 60000 });
    const mayRead = createLimiter({ limit: 300, windowMs: 60000 });
    router.use(sessions.requireAuth, (req, res, next) => {
        check(req.auth.user.encryption, 'Set up encryption by logging in again.', 403);
        check(mayRead(String(req.auth.user._id)), 'Too many requests. Try again in a minute.', 429);
        next();
    });
    router.get('/users', async (req, res) => {
        const query = req.query.q ?? '';
        check(typeof query === 'string' && query.length <= 32, 'Invalid search');
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const users = await User.find({
            _id: { $ne: req.auth.user._id }, encryption: { $exists: true },
            username: { $regex: escaped, $options: 'i' },
        }).select('username +encryption').sort({ username: 1, _id: 1 }).limit(51);
        res.json({ users: users.slice(0, 50).map(publicUser), hasMore: users.length > 50 });
    });
    router.get('/messages/:peerId', async (req, res) => {
        const { peerId } = req.params;
        check(isId(peerId) && peerId !== String(req.auth.user._id), 'Invalid recipient');
        check(!req.query.before || isId(req.query.before), 'Invalid history cursor');
        check(await User.exists({ _id: peerId, encryption: { $exists: true } }), 'Recipient not found', 404);
        const filter = { conversationId: conversationId(req.auth.user._id, peerId) };
        if (req.query.before) {
            const cursor = await Message.findOne({ ...filter, _id: req.query.before }).select('createdAt');
            check(cursor, 'Invalid history cursor');
            filter.$or = [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
            ];
        }
        const messages = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(51);
        const page = messages.slice(0, 50);
        res.json({
            messages: page.reverse().map(serializeMessage),
            nextCursor: messages.length > 50 ? String(messages[49]._id) : null,
        });
    });
    router.post('/messages', async (req, res) => {
        const data = req.body;
        validateMessage(data);
        const senderId = String(req.auth.user._id);
        check(data.senderId === senderId, 'Sender does not match your account', 403);
        check(data.recipientId !== senderId, 'Choose another person to chat with');
        check(maySend(senderId), 'Too many messages. Try again in a minute.', 429);
        check(await User.exists({ _id: data.recipientId, encryption: { $exists: true } }), 'Recipient not found', 404);
        let message;
        let created = true;
        try {
            message = await Message.create({ ...data, senderId, conversationId: conversationId(senderId, data.recipientId) });
        } catch (error) {
            if (error.code !== 11000) throw error;
            created = false;
            message = await Message.findOne({ senderId, clientId: data.clientId });
            check(message && String(message.recipientId) === data.recipientId
                && message.iv === data.iv && message.ciphertext === data.ciphertext, 'Message ID already used', 409);
        }
        const payload = serializeMessage(message);
        // Delivery notifications follow a successful durable write, including safe retries.
        io.to(`user:${senderId}`).to(`user:${data.recipientId}`).emit('new_message', payload);
        res.status(created ? 201 : 200).json({ message: payload });
    });
    return router;
}
module.exports = { createChatRoutes, serializeMessage };
