const { createPublicKey } = require('node:crypto');

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function check(condition, message = 'Invalid request', status = 400) {
    if (!condition) throw new HttpError(status, message);
}
function base64(value, min, max = min) {
    if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const bytes = Buffer.from(value, 'base64');
    return bytes.length >= min && bytes.length <= max && bytes.toString('base64') === value;
}
function validateEncryption(value) {
    check(value && value.version === 1 && base64(value.salt, 16) && base64(value.iv, 12)
        && base64(value.publicKey, 65) && base64(value.encryptedPrivateKey, 100, 512), 'Invalid encryption settings');
    const raw = Buffer.from(value.publicKey, 'base64');
    check(raw[0] === 4, 'Invalid public key');
    try {
        createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    } catch { throw new HttpError(400, 'Invalid public key'); }
    return { version: 1, salt: value.salt, iv: value.iv, publicKey: value.publicKey, encryptedPrivateKey: value.encryptedPrivateKey };
}
function validateMessage(value) {
    check(value && typeof value === 'object' && Object.keys(value).every((key) =>
        ['version', 'clientId', 'senderId', 'recipientId', 'ciphertext', 'iv'].includes(key)), 'Only encrypted messages are accepted');
    check(value.version === 1 && typeof value.clientId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.clientId)
        && isId(value.recipientId) && base64(value.iv, 12) && base64(value.ciphertext, 17, 16016), 'Invalid encrypted message');
}
function isId(value) { return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value); }
module.exports = { HttpError, check, base64, isId, validateEncryption, validateMessage };
