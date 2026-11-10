const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApplication } = require('../app');
const { migrateEmails } = require('../lib/privacy');
const User = require('../models/User');
const Message = require('../models/Message');
const Session = require('../models/Session');
const { hashToken } = require('../services/sessions');
const { createLimiter } = require('../lib/rate-limit');
const { io } = require('socket.io-client');

let mongo, runtime, url, cryptoApi, alice, bob, eve;
const secret = randomBytes(48).toString('hex');
const dataKey = randomBytes(32).toString('hex');
const sockets = [];
const staticDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'simplechat-static-test-'));
fs.writeFileSync(path.join(staticDirectory, 'index.html'), '<!doctype html><title>SimpleChat</title><div id="root"></div>');
const config = { secret, dataKey, authLimit: 1000, staticDirectory };

async function api(path, { token, body, method = 'GET' } = {}) {
    const response = await fetch(url + '/api' + path, {
        method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
async function listen() {
    runtime = createApplication(config);
    runtime.server.listen(0, '127.0.0.1');
    await once(runtime.server, 'listening');
    url = 'http://127.0.0.1:' + runtime.server.address().port;
}
async function closeServer() {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => runtime.io.close(resolve));
}
async function account(username) {
    const identity = await cryptoApi.createIdentity(username + ' secret passphrase 123');
    const registered = await api('/auth/register', { method: 'POST', body: { username, email: username + '@example.test', authKey: identity.authKey, encryption: identity.encryption } });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    const login = await api('/auth/login', { method: 'POST', body: { identifier: username, authKey: identity.authKey } });
    assert.equal(login.status, 200);
    return { ...identity, ...login.data };
}
async function connect(token) {
    const socket = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
}
async function envelope(sender, recipient, text = 'Secret text kept out of MongoDB') {
    const key = await cryptoApi.conversationKey(sender.privateKey, recipient.encryption.publicKey, sender.user.id, recipient.user.id);
    return cryptoApi.encryptMessage(key, text, sender.user.id, recipient.user.id);
}

before(async () => {
    cryptoApi = await import('../../frontend/src/lib/crypto.js');
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'simplechat_test' });
    await Promise.all([User.init(), Message.init(), Session.init()]);
    await listen();
    [alice, bob, eve] = await Promise.all([account('alice'), account('bob'), account('eve')]);
}, { timeout: 120000 });
after(async () => {
    if (runtime) await closeServer();
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
    fs.rmSync(staticDirectory, { recursive: true, force: true });
});

test('registration protects credentials and email, rejects duplicates, and exposes only public profiles', async () => {
    const user = await User.findById(alice.user.id).select('+password +email +emailLookup +encryption').lean();
    assert.match(user.password, /^\$2[aby]\$12\$/);
    assert.equal(await bcrypt.compare(alice.authKey, user.password), true);
    assert.equal(JSON.stringify(user).includes('alice@example.test'), false);
    assert.match(user.email, /^v1:/);
    assert.equal(user.encryption.encryptedPrivateKey, alice.encryption.encryptedPrivateKey);
    const directory = await api('/users', { token: bob.token });
    assert.equal(directory.status, 200);
    assert.deepEqual(Object.keys(directory.data.users[0]).sort(), ['id', 'publicKey', 'username']);
    assert.equal(directory.data.users.some((user) => user.id === bob.user.id), false);
    assert.equal((await api('/auth/register', { method: 'POST', body: { username: 'another', email: 'ALICE@EXAMPLE.TEST', authKey: bob.authKey, encryption: bob.encryption } })).status, 409);
    assert.equal((await api('/auth/register', { method: 'POST', body: { username: 'invalid@name', email: 'invalid', password: 'plaintext' } })).status, 400);
    assert.equal((await api('/users?q=%5B', { token: alice.token })).status, 200);
    const emailLogin = await api('/auth/login', { method: 'POST', body: { identifier: ' ALICE@EXAMPLE.TEST ', authKey: alice.authKey } });
    assert.equal(emailLogin.status, 200);
    const parameters = await api('/auth/parameters', { method: 'POST', body: { identifier: 'alice@example.test' } });
    assert.equal(parameters.data.salt, alice.encryption.salt);
    const sessions = await Session.find({}).lean();
    assert.equal(JSON.stringify(sessions).includes(alice.token), false);
});

test('HTTP and sockets reject missing, forged, expired and revoked sessions', async () => {
    for (const token of [undefined, 'forged', jwt.sign({ userId: alice.user.id }, secret, { expiresIn: -1 })]) {
        assert.equal((await api('/users', { token })).status, 401);
        const socket = io(url, { auth: { token }, reconnection: false, transports: ['websocket'] });
        sockets.push(socket);
        const [error] = await once(socket, 'connect_error');
        assert.equal(error.data.code, 'UNAUTHORIZED');
    }
    assert.equal((await api('/auth/login', { method: 'POST', body: { identifier: 'alice', authKey: bob.authKey } })).status, 401);
    assert.equal((await api('/auth/login', { method: 'POST', body: { identifier: { $ne: null }, authKey: alice.authKey } })).status, 400);
    assert.equal((await api('/messages/invalid', { token: alice.token })).status, 400);
});

test('encrypted messages reach both participants and their devices, never a third user, and retry idempotently', async () => {
    const [aliceSocket, bobSocket, otherDevice, eveSocket] = await Promise.all([
        connect(alice.token), connect(bob.token), connect(bob.token), connect(eve.token),
    ]);
    const leaked = [];
    eveSocket.on('new_message', (message) => leaked.push(message));
    // An attacker cannot subscribe to another user's room.
    eveSocket.emit('join', 'user:' + bob.user.id);
    const received = [once(aliceSocket, 'new_message'), once(bobSocket, 'new_message'), once(otherDevice, 'new_message')];
    const encrypted = await envelope(alice, bob);
    const result = await api('/messages', { method: 'POST', token: alice.token, body: encrypted });
    assert.equal(result.status, 201);
    const deliveries = await Promise.all(received);
    assert.ok(deliveries.every(([message]) => message.id === result.data.message.id));
    assert.equal(leaked.length, 0);
    const retry = await api('/messages', { method: 'POST', token: alice.token, body: encrypted });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.message.id, result.data.message.id);
    assert.equal(await Message.countDocuments({ senderId: alice.user.id, clientId: encrypted.clientId }), 1);
    const stored = await Message.findById(result.data.message.id).lean();
    assert.equal(JSON.stringify(stored).includes('Secret text'), false);
    assert.equal('content' in stored, false);
    const bobKey = await cryptoApi.conversationKey(bob.privateKey, alice.encryption.publicKey, bob.user.id, alice.user.id);
    assert.equal(await cryptoApi.decryptMessage(bobKey, result.data.message), 'Secret text kept out of MongoDB');
    assert.equal((await api('/messages/' + alice.user.id, { token: bob.token })).data.messages.length, 1);
    assert.deepEqual((await api('/messages/' + alice.user.id, { token: eve.token })).data.messages, []);
});

test('message validation blocks plaintext, sender spoofing, invalid recipients and conflicting retries', async () => {
    const encrypted = await envelope(alice, bob);
    const rejected = [
        [{ text: 'plaintext' }, 400],
        [{ ...encrypted, text: 'also plaintext' }, 400],
        [{ ...encrypted, senderId: eve.user.id }, 403],
        [{ ...encrypted, recipientId: '000000000000000000000000' }, 404],
        [{ ...encrypted, recipientId: alice.user.id }, 400],
        [{ ...encrypted, iv: 'invalid' }, 400],
        [{ ...encrypted, ciphertext: 'A'.repeat(24000) }, 400],
    ];
    for (const [body, status] of rejected) assert.equal((await api('/messages', { method: 'POST', token: alice.token, body })).status, status);
    assert.equal((await api('/messages', { method: 'POST', token: alice.token, body: encrypted })).status, 201);
    assert.equal((await api('/messages', { method: 'POST', token: alice.token, body: { ...encrypted, iv: randomBytes(12).toString('base64') } })).status, 409);
});

test('history is paginated without overlap and survives a server restart', async () => {
    for (let index = 0; index < 55; index += 1) {
        const result = await api('/messages', { method: 'POST', token: bob.token, body: await envelope(bob, eve, 'History ' + index) });
        assert.equal(result.status, 201);
    }
    await closeServer();
    await listen();
    const newest = await api('/messages/' + bob.user.id, { token: eve.token });
    assert.equal(newest.data.messages.length, 50);
    const older = await api('/messages/' + bob.user.id + '?before=' + newest.data.nextCursor, { token: eve.token });
    assert.equal(older.data.messages.length, 5);
    assert.equal(older.data.nextCursor, null);
    assert.equal(new Set([...older.data.messages, ...newest.data.messages].map((message) => message.id)).size, 55);
});

test('logout revokes the database session, disconnects its sockets and keeps other device sessions valid', async () => {
    const extra = await api('/auth/login', { method: 'POST', body: { identifier: 'alice', authKey: alice.authKey } });
    const socket = await connect(extra.data.token);
    const disconnected = once(socket, 'disconnect');
    assert.equal((await api('/auth/session', { token: extra.data.token, method: 'DELETE' })).status, 204);
    await disconnected;
    assert.equal((await api('/users', { token: extra.data.token })).status, 401);
    assert.equal((await api('/users', { token: alice.token })).status, 200);
});

test('expired database sessions cannot authorize a socket or history even before TTL deletion', async () => {
    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'alice', authKey: alice.authKey } });
    await Session.updateOne({ tokenHash: hashToken(login.data.token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await api('/users', { token: login.data.token })).status, 401);
});

test('connected sockets stop receiving when their session expires', async () => {
    const token = jwt.sign({ userId: alice.user.id }, secret, {
        algorithm: 'HS256', issuer: 'simplechat', audience: 'simplechat-client', expiresIn: 2,
    });
    const expiresAt = new Date(jwt.decode(token).exp * 1000);
    await Session.create({ tokenHash: hashToken(token), userId: alice.user.id, expiresAt });
    const socket = await connect(token);
    const expired = once(socket, 'session_expired');
    const disconnected = once(socket, 'disconnect');
    await Promise.all([expired, disconnected]);
    assert.equal((await api('/users', { token })).status, 401);
});

test('public pages refresh correctly and API failures stay JSON', async () => {
    for (const path of ['/login', '/register', '/chat']) {
        const response = await fetch(url + path);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    }
    const missing = await api('/missing', { token: alice.token });
    assert.equal(missing.status, 404);
    assert.equal(typeof missing.data.message, 'string');
    const malformed = await fetch(url + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).message, 'Invalid JSON');
});

test('auth routes enforce limits and production-origin restrictions', async () => {
    const limited = createApplication({ ...config, authLimit: 1, publicOrigin: 'https://chat.example.test' });
    limited.server.listen(0, '127.0.0.1');
    await once(limited.server, 'listening');
    const endpoint = 'http://127.0.0.1:' + limited.server.address().port + '/api/auth/parameters';
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'alice' }) };
    try {
        assert.equal((await fetch(endpoint, { ...init, headers: { ...init.headers, Origin: 'https://untrusted.example.test' } })).status, 403);
        assert.equal((await fetch(endpoint, init)).status, 200);
        const throttled = await fetch(endpoint, init);
        assert.equal(throttled.status, 429);
        assert.equal(throttled.headers.get('retry-after'), '900');
    } finally { await new Promise((resolve) => limited.io.close(resolve)); }
});

test('legacy accounts migrate without losing login access or exposing legacy plaintext messages', async () => {
    const user = await User.create({ username: 'legacy', email: 'legacy@example.test', password: await bcrypt.hash('legacy password', 12) });
    await migrateEmails(runtime.privacy);
    await migrateEmails(runtime.privacy);
    const stored = await User.findById(user._id).select('+email');
    assert.match(stored.email, /^v1:/);
    const parameters = await api('/auth/parameters', { method: 'POST', body: { identifier: 'legacy@example.test' } });
    assert.equal(parameters.data.legacy, true);
    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'legacy', password: 'legacy password' } });
    assert.equal(login.status, 200);
    assert.equal((await api('/users', { token: login.data.token })).status, 403);
    const identity = await cryptoApi.createIdentity('legacy password');
    const upgrade = await api('/auth/encryption', { method: 'POST', token: login.data.token, body: { authKey: identity.authKey, encryption: identity.encryption } });
    assert.equal(upgrade.status, 200);
    assert.equal((await api('/users', { token: login.data.token })).status, 401);
    assert.equal((await api('/auth/parameters', { method: 'POST', body: { identifier: 'legacy@example.test' } })).data.legacy, false);
    assert.equal((await api('/auth/login', { method: 'POST', body: { identifier: 'legacy', authKey: identity.authKey } })).status, 200);
    await mongoose.connection.collection('messages').insertOne({ senderId: user._id, roomId: 'general', content: 'old plaintext' });
    const history = await api('/messages/' + alice.user.id, { token: upgrade.data.token });
    assert.deepEqual(history.data.messages, []);
    assert.equal((await api('/auth/encryption', { method: 'POST', token: upgrade.data.token, body: { authKey: identity.authKey, encryption: identity.encryption } })).status, 409);
});

test('rate limiting and invalid runtime secrets fail closed', () => {
    const allowed = createLimiter({ limit: 2, windowMs: 10000, maxKeys: 1 });
    assert.equal(allowed('one'), true);
    assert.equal(allowed('one'), true);
    assert.equal(allowed('one'), false);
    assert.equal(allowed('two'), false);
    assert.throws(() => createApplication({ secret: 'weak', dataKey }));
    assert.throws(() => createApplication({ secret, dataKey: 'weak' }));
});
