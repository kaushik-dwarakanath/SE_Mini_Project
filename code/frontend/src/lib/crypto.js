// Protocol v1. Only browser-generated public keys and ciphertext leave the client.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const KDF_ITERATIONS = 600_000;
export const MAX_MESSAGE_LENGTH = 4000;

export function requireCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure chat needs HTTPS (or localhost). Open the HTTPS address of this app.');
  }
}

function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function decode(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function createSalt() {
  requireCrypto();
  return encode(crypto.getRandomValues(new Uint8Array(16)));
}

async function expand(material, label, usages) {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode(label) },
    material, { name: 'AES-GCM', length: 256 }, false, usages,
  );
}

export async function deriveCredentials(password, salt) {
  requireCrypto();
  if (decode(salt).length !== 16) throw new Error('Invalid account encryption settings.');
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const root = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations: KDF_ITERATIONS }, passwordKey, 256,
  );
  const material = await crypto.subtle.importKey('raw', root, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode('simplechat:auth:v1') }, material, 256,
  );
  // The server receives only this separate login secret, never the vault key or password.
  const authKey = encode(authBits);
  const wrappingKey = await expand(material, 'simplechat:vault:v1', ['encrypt', 'decrypt']);
  return { authKey, wrappingKey };
}

export async function createIdentity(password) {
  const salt = createSalt();
  const { authKey, wrappingKey } = await deriveCredentials(password, salt);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = encode(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateBytes = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = encode(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`simplechat:vault:v1:${publicKey}`) }, wrappingKey, privateBytes,
  ));
  const encryption = { version: 1, salt, publicKey, encryptedPrivateKey, iv: encode(iv) };
  const privateKey = await unlockIdentity(wrappingKey, encryption);
  return { authKey, encryption, privateKey };
}

export async function unlockIdentity(wrappingKey, encryption) {
  if (encryption.version !== 1) throw new Error('Unsupported encryption version.');
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(encryption.iv), additionalData: encoder.encode(`simplechat:vault:v1:${encryption.publicKey}`) },
    wrappingKey, decode(encryption.encryptedPrivateKey),
  );
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

export async function conversationKey(privateKey, publicKey, userId, peerId) {
  const peer = await crypto.subtle.importKey('raw', decode(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return expand(material, `simplechat:conversation:v1:${[userId, peerId].sort().join(':')}`, ['encrypt', 'decrypt']);
}

function messageContext(message) {
  return encoder.encode(JSON.stringify([1, message.clientId, message.senderId, message.recipientId]));
}

export async function encryptMessage(key, text, senderId, recipientId) {
  if (!text.trim() || text.trim().length > MAX_MESSAGE_LENGTH) throw new Error('Messages must contain 1–4000 characters.');
  const message = { version: 1, clientId: crypto.randomUUID(), senderId, recipientId };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: messageContext(message) }, key, encoder.encode(text.trim()),
  );
  return { ...message, iv: encode(iv), ciphertext: encode(ciphertext) };
}

export async function decryptMessage(key, message) {
  if (message.version !== 1) throw new Error('Unsupported message version.');
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(message.iv), additionalData: messageContext(message) }, key, decode(message.ciphertext),
  );
  return decoder.decode(bytes);
}

export async function safetyNumber(firstKey, secondKey) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode([firstKey, secondKey].sort().join(':')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').match(/.{1,8}/g).join(' ');
}
