const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    version: { type: Number, required: true, enum: [1] },
    clientId: { type: String, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: String, required: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
}, { timestamps: true, strict: 'throw', collection: 'encrypted_messages' });

messageSchema.index({ senderId: 1, clientId: 1 }, { unique: true });
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model('Message', messageSchema);
