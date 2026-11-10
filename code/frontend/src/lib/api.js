export async function request(path, { token, body, method = 'GET', signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The server returned an unexpected response. Please try again.'); }
  if (!response.ok) {
    const error = new Error(data.message || 'The request failed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
