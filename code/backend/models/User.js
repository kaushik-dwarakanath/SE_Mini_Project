const mongoose = require('mongoose');

const encryptionSchema = new mongoose.Schema({
    version: { type: Number, required: true, enum: [1] },
    salt: { type: String, required: true },
    publicKey: { type: String, required: true },
    encryptedPrivateKey: { type: String, required: true },
    iv: { type: String, required: true },
}, { _id: false, strict: 'throw' });

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    // Existing plaintext emails are migrated before the server accepts traffic.
    email: { type: String, required: true, unique: true, select: false },
    emailLookup: { type: String, unique: true, sparse: true, select: false },
    password: { type: String, required: true, select: false },
    encryption: { type: encryptionSchema, select: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
