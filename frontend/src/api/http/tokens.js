/**
 * Access and refresh tokens for the real backend, plus fetch with silent refresh.
 *
 * Access tokens live 15 minutes (JWT_EXPIRES_IN). When a call comes back 401,
 * the refresh token is traded for a new pair at POST /users/auth/refresh and the
 * call is sent again once. Only when the refresh itself fails (expired after 30
 * days, revoked, account disabled) is the user signed out.
 *
 * User-Service rotates refresh tokens and treats reuse of an old one as theft,
 * revoking the whole session. So a refresh must never run twice with the same
 * token: calls in this tab share one refresh, and tabs take turns through a
 * Web Lock, re-reading storage first in case another tab already refreshed.
 */
import { getSessionUser, setSessionUser } from "../session.js";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace(/\/$/, "");
const SESSION_KEY = "smartfix-session";
const REFRESH_KEY = "smartfix-refresh-token";
const LOCK_NAME = "smartfix-token-refresh";

export function accessToken() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY))?.accessToken || null;
    } catch {
        return null;
    }
}

export function readRefreshToken() {
    try {
        return localStorage.getItem(REFRESH_KEY);
    } catch {
        return null;
    }
}

export function storeRefreshToken(token) {
    try {
        if (token) localStorage.setItem(REFRESH_KEY, token);
        else localStorage.removeItem(REFRESH_KEY);
    } catch {
        // storage unavailable
    }
}

function signOutLocally() {
    storeRefreshToken(null);
    setSessionUser(null);
}

async function withTabLock(work) {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
        return navigator.locks.request(LOCK_NAME, work);
    }
    return work();
}

async function exchangeRefreshToken(failedToken) {
    // Another tab (or an earlier call here) may already have a newer token.
    const current = accessToken();
    if (current && current !== failedToken) return current;

    const refreshToken = readRefreshToken();
    if (!refreshToken) {
        signOutLocally();
        return null;
    }
    let response;
    try {
        response = await fetch(`${API_URL}/users/auth/refresh`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
    } catch {
        // Network trouble is not a reason to sign out; the caller sees the 401.
        return null;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false || !payload?.data?.access_token) {
        if (response.status === 401 || response.status === 400) signOutLocally();
        return null;
    }
    const data = payload.data;
    storeRefreshToken(data.refresh_token);
    const user = getSessionUser();
    setSessionUser(user ? { ...user, roles: data.roles || user.roles } : user, data.access_token);
    return data.access_token;
}

let inFlight = null;

/** Returns a fresh access token, or null when the session cannot be renewed. */
export function refreshAccessToken(failedToken) {
    if (!inFlight) {
        inFlight = withTabLock(() => exchangeRefreshToken(failedToken))
            .finally(() => {
                inFlight = null;
            });
    }
    return inFlight;
}

/**
 * fetch() that adds the bearer token and, on a 401, refreshes once and retries.
 * `headers` must be a plain object; the Authorization header is set here.
 */
export async function authFetch(url, { headers = {}, ...init } = {}) {
    const token = accessToken();
    const send = (bearer) => fetch(url, {
        ...init,
        headers: bearer ? { ...headers, authorization: `Bearer ${bearer}` } : headers
    });
    const response = await send(token);
    if (response.status !== 401 || !token) return response;

    const renewed = await refreshAccessToken(token);
    return renewed ? send(renewed) : response;
}
