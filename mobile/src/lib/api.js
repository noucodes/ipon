import { API_URL } from './config';

export class ApiError extends Error {
  constructor(status, code, message, issues) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

let authToken = null;
let onUnauthorized = () => {};

export function setAuthToken(token) {
  authToken = token;
}
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Render's free plan sleeps; the first request can take ~a minute to wake it.
const TIMEOUT_MS = 70_000;

export async function api(method, path, body, { timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(0, 'network_error', err.name === 'AbortError'
      ? 'The server took too long to respond. Try again.'
      : "Can't reach the server. Check your internet connection.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized();
    const error = new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`, data?.issues);
    if (data?.account_id) error.accountId = data.account_id; // e.g. person_exists points at the existing person
    throw error;
  }
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body, opts) => api('POST', path, body ?? {}, opts);
export const patch = (path, body) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);

/** Build a query string, skipping empty values. */
export function qs(params) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return s ? `?${s}` : '';
}
