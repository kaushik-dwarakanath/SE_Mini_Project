const { createHash, randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const User = require('../models/User');
const { HttpError } = require('../lib/validation');

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
function createSessions(secret) {
    const options = { algorithms: ['HS256'], issuer: 'simplechat', audience: 'simplechat-client' };
    async function issue(user) {
        const token = jwt.sign({ userId: String(user._id) }, secret, {
            algorithm: 'HS256', issuer: options.issuer, audience: options.audience, expiresIn: '1h', jwtid: randomUUID(),
        });
        const { exp } = jwt.decode(token);
        await Session.create({ tokenHash: hashToken(token), userId: user._id, expiresAt: new Date(exp * 1000) });
        return { token, expiresAt: new Date(exp * 1000).toISOString() };
    }
    async function authenticate(token) {
        if (typeof token !== 'string' || token.length > 2048) throw new HttpError(401, 'Please log in again.');
        let claims;
        try { claims = jwt.verify(token, secret, options); }
        catch { throw new HttpError(401, 'Please log in again.'); }
        const tokenHash = hashToken(token);
        const session = await Session.findOne({ tokenHash, userId: claims.userId, expiresAt: { $gt: new Date() } });
        if (!session) throw new HttpError(401, 'Please log in again.');
        const user = await User.findById(session.userId).select('+encryption');
        if (!user) throw new HttpError(401, 'Please log in again.');
        return { user, tokenHash, expiresAt: session.expiresAt };
    }
    async function requireAuth(req, res, next) {
        try {
            const header = req.get('authorization');
            req.auth = await authenticate(header?.startsWith('Bearer ') ? header.slice(7) : null);
            next();
        } catch (error) { next(error); }
    }
    return { issue, authenticate, requireAuth };
}
module.exports = { createSessions, hashToken };
