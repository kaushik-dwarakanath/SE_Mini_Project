import { request } from './api';
import { createIdentity, deriveCredentials, requireCrypto, unlockIdentity } from './crypto';

export async function registerAccount({ username, email, password }) {
  const { authKey, encryption } = await createIdentity(password);
  return request('/auth/register', { method: 'POST', body: { username, email, authKey, encryption } });
}

export async function loginAccount(identifier, password) {
  // Check before the legacy password path too, so insecure LAN HTTP fails locally.
  requireCrypto();
  const parameters = await request('/auth/parameters', { method: 'POST', body: { identifier } });
  let result;
  try {
    let privateKey;
    if (parameters.legacy) {
      // One-time compatibility path for accounts from the original project.
      result = await request('/auth/login', { method: 'POST', body: { identifier, password } });
      const identity = await createIdentity(password);
      result = await request('/auth/encryption', {
        method: 'POST', token: result.token, body: { authKey: identity.authKey, encryption: identity.encryption },
      });
      privateKey = identity.privateKey;
    } else {
      const { authKey, wrappingKey } = await deriveCredentials(password, parameters.salt);
      result = await request('/auth/login', { method: 'POST', body: { identifier, authKey } });
      try { privateKey = await unlockIdentity(wrappingKey, result.encryption); }
      catch { throw new Error('Your message keys could not be unlocked. Please check your password and try again.'); }
    }
    return { token: result.token, expiresAt: result.expiresAt, user: result.user, privateKey };
  } catch (error) {
    if (result?.token) {
      try { await request('/auth/session', { method: 'DELETE', token: result.token }); } catch { /* Session expires server-side. */ }
    }
    throw error;
  }
}
