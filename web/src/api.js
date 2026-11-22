// Tiny API client for the overview site. The login token is kept in this browser only.
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const TOKEN_KEY = 'ipon_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. It may be waking up, so try again in a moment.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message || `Request failed (${res.status})`);
  return data;
}
