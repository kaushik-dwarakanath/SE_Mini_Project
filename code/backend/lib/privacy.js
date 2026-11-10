const { hkdfSync, createHmac, randomBytes, createCipheriv } = require('node:crypto');
const User = require('../models/User');

function createPrivacy(secret) {
    const key = (purpose) => Buffer.from(hkdfSync('sha256', secret, '', `simplechat:${purpose}:v1`, 32));
    const encryptionKey = key('email');
    const lookupKey = key('email-lookup');
    const emailLookup = (email) => createHmac('sha256', lookupKey).update(email.trim().toLowerCase()).digest('hex');
    const protectEmail = (email) => {
        const normalized = email.trim().toLowerCase();
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
        cipher.setAAD(Buffer.from('simplechat:email:v1'));
        const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
        return { email: `v1:${iv.toString('base64')}:${encrypted.toString('base64')}:${cipher.getAuthTag().toString('base64')}`, emailLookup: emailLookup(normalized) };
    };
    return { emailLookup, protectEmail };
}
async function migrateEmails(privacy) {
    // Idempotent, one-record atomic migration; old accounts remain usable.
    for await (const user of User.find({ emailLookup: { $exists: false } }).select('+email').cursor()) {
        if (user.email.startsWith('v1:')) throw new Error('Account email migration needs repair');
        await User.updateOne({ _id: user._id, emailLookup: { $exists: false } }, { $set: privacy.protectEmail(user.email) });
    }
}
module.exports = { createPrivacy, migrateEmails };
