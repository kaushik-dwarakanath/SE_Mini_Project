const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let cryptoApi, alice, bob, eve, aliceKey, bobKey;
const aliceId = '000000000000000000000001';
const bobId = '000000000000000000000002';

before(async () => {
    cryptoApi = await import('../../frontend/src/lib/crypto.js');
    [alice, bob, eve] = await Promise.all([
        cryptoApi.createIdentity('Alice private passphrase 123'),
        cryptoApi.createIdentity('Bob private passphrase 456'),
        cryptoApi.createIdentity('Eve private passphrase 789'),
    ]);
    [aliceKey, bobKey] = await Promise.all([
        cryptoApi.conversationKey(alice.privateKey, bob.encryption.publicKey, aliceId, bobId),
        cryptoApi.conversationKey(bob.privateKey, alice.encryption.publicKey, bobId, aliceId),
    ]);
});

test('two independent identities encrypt, decrypt Unicode, and derive the same safety number', async () => {
    const message = await cryptoApi.encryptMessage(aliceKey, '  Hello 👋 नमस्ते <script>text</script>  ', aliceId, bobId);
    assert.equal(await cryptoApi.decryptMessage(bobKey, message), 'Hello 👋 नमस्ते <script>text</script>');
    assert.equal(await cryptoApi.decryptMessage(aliceKey, message), 'Hello 👋 नमस्ते <script>text</script>');
    assert.equal(
        await cryptoApi.safetyNumber(alice.encryption.publicKey, bob.encryption.publicKey),
        await cryptoApi.safetyNumber(bob.encryption.publicKey, alice.encryption.publicKey),
    );
    assert.equal(JSON.stringify(message).includes('Hello'), false);
});

test('new device recovers the same private key from the encrypted vault', async () => {
    const credentials = await cryptoApi.deriveCredentials('Alice private passphrase 123', alice.encryption.salt);
    assert.equal(credentials.authKey, alice.authKey);
    const restored = await cryptoApi.unlockIdentity(credentials.wrappingKey, alice.encryption);
    assert.equal(restored.extractable, false);
    const restoredKey = await cryptoApi.conversationKey(restored, bob.encryption.publicKey, aliceId, bobId);
    const message = await cryptoApi.encryptMessage(bobKey, 'Saved before signing in on a new device', bobId, aliceId);
    assert.equal(await cryptoApi.decryptMessage(restoredKey, message), 'Saved before signing in on a new device');
});

test('wrong password and the server-visible authentication secret cannot unlock the vault', async () => {
    for (const password of ['incorrect password', alice.authKey]) {
        const credentials = await cryptoApi.deriveCredentials(password, alice.encryption.salt);
        await assert.rejects(cryptoApi.unlockIdentity(credentials.wrappingKey, alice.encryption));
    }
});

test('tampered ciphertext, metadata, public key and unrelated recipients fail authentication', async () => {
    const message = await cryptoApi.encryptMessage(aliceKey, 'private', aliceId, bobId);
    const bytes = Buffer.from(message.ciphertext, 'base64');
    bytes[0] ^= 1;
    await assert.rejects(cryptoApi.decryptMessage(bobKey, { ...message, ciphertext: bytes.toString('base64') }));
    await assert.rejects(cryptoApi.decryptMessage(bobKey, { ...message, senderId: bobId }));
    await assert.rejects(cryptoApi.decryptMessage(bobKey, { ...message, clientId: crypto.randomUUID() }));
    const eveKey = await cryptoApi.conversationKey(eve.privateKey, alice.encryption.publicKey, bobId, aliceId);
    await assert.rejects(cryptoApi.decryptMessage(eveKey, message));
    const credentials = await cryptoApi.deriveCredentials('Alice private passphrase 123', alice.encryption.salt);
    await assert.rejects(cryptoApi.unlockIdentity(credentials.wrappingKey, { ...alice.encryption, publicKey: bob.encryption.publicKey }));
});

test('fresh encryption uses distinct nonces and rejects blank or oversized messages', async () => {
    const one = await cryptoApi.encryptMessage(aliceKey, 'same', aliceId, bobId);
    const two = await cryptoApi.encryptMessage(aliceKey, 'same', aliceId, bobId);
    assert.notEqual(one.iv, two.iv);
    assert.notEqual(one.ciphertext, two.ciphertext);
    await assert.rejects(cryptoApi.encryptMessage(aliceKey, '   ', aliceId, bobId));
    await assert.rejects(cryptoApi.encryptMessage(aliceKey, 'x'.repeat(4001), aliceId, bobId));
});
