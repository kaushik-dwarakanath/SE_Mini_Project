const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { createSessions } = require('./services/sessions');
const { createPrivacy } = require('./lib/privacy');
const { createAuthRoutes } = require('./routes/auth');
const { createChatRoutes } = require('./routes/chat');
const { HttpError, check } = require('./lib/validation');

function createApplication({ secret, dataKey, publicOrigin, authLimit, trustProxy = false,
    staticDirectory = path.resolve(__dirname, '../frontend/dist') }) {
    check(typeof secret === 'string' && secret.length >= 32 && !secret.includes('replace-this'), 'JWT_SECRET must be a strong secret of at least 32 characters');
    check(typeof dataKey === 'string' && /^[a-f0-9]{64}$/i.test(dataKey), 'DATA_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters');
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        serveClient: false, maxHttpBufferSize: 32768,
        allowRequest: (req, callback) => callback(null, !publicOrigin || !req.headers.origin || req.headers.origin === publicOrigin),
    });
    const sessions = createSessions(secret);
    const privacy = createPrivacy(Buffer.from(dataKey, 'hex'));
    app.disable('x-powered-by');
    app.set('trust proxy', trustProxy);
    app.use((req, res, next) => {
        res.set({
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        });
        if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
        if (publicOrigin && req.get('origin') && req.get('origin') !== publicOrigin) {
            return res.status(403).json({ message: 'Origin is not allowed' });
        }
        next();
    });
    app.use(express.json({ limit: '32kb' }));
    app.get('/api/health', (req, res) => {
        const ready = mongoose.connection.readyState === 1;
        res.status(ready ? 200 : 503).json({ status: ready ? 'OK' : 'unavailable' });
    });
    app.use('/api/auth', createAuthRoutes({ sessions, privacy, io, secret, authLimit }));
    app.use('/api', createChatRoutes({ sessions, io }));
    // API failures must remain JSON, never the SPA fallback.
    app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint not found' }));
    const frontend = staticDirectory;
    if (fs.existsSync(path.join(frontend, 'index.html'))) {
        app.use(express.static(frontend, { index: false }));
        app.get(['/', '/login', '/register', '/chat'], (req, res) => {
            res.set('Cache-Control', 'no-cache');
            res.sendFile(path.join(frontend, 'index.html'));
        });
    }
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.code === 11000) return res.status(409).json({ message: 'Username or email already exists' });
        if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
        if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large' });
        if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
        if (error.name === 'ValidationError' || error.name === 'StrictModeError') return res.status(400).json({ message: 'Invalid request' });
        // Never log credentials, database URIs, ciphertext or request bodies.
        console.error('Request failed:', error.name);
        res.status(500).json({ message: 'The server could not complete the request. Please try again.' });
    });
    io.use(async (socket, next) => {
        try {
            socket.data.auth = await sessions.authenticate(socket.handshake.auth?.token);
            check(socket.data.auth.user.encryption, 'Log in to set up encryption.', 403);
            next();
        } catch {
            const error = new Error('Please log in again.');
            error.data = { code: 'UNAUTHORIZED' };
            next(error);
        }
    });
    io.on('connection', async (socket) => {
        const { user, tokenHash, expiresAt } = socket.data.auth;
        socket.join(`user:${user._id}`);
        socket.join(`session:${tokenHash}`);
        // Close the race between handshake validation, room join and concurrent logout.
        try { await sessions.authenticate(socket.handshake.auth.token); }
        catch {
            socket.emit('session_expired');
            socket.disconnect(true);
            return;
        }
        if (!socket.connected) return;
        const timer = setTimeout(() => {
            socket.emit('session_expired');
            socket.disconnect(true);
        }, Math.max(0, expiresAt.getTime() - Date.now()));
        timer.unref();
        socket.on('disconnect', () => clearTimeout(timer));
        // Clients cannot join arbitrary rooms or publish through unauthenticated events.
    });
    return { app, server, io, sessions, privacy };
}
module.exports = { createApplication };
