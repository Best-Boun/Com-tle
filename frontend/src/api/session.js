/**
 * Current signed-in user, kept in localStorage.
 * With the real backend this will also hold the JWT access token.
 */
const KEY = "smartfix-session";
const listeners = new Set();

export function getSessionUser() {
    try {
        return JSON.parse(localStorage.getItem(KEY))?.user || null;
    } catch {
        return null;
    }
}

export function setSessionUser(user, accessToken = null) {
    try {
        if (user) localStorage.setItem(KEY, JSON.stringify({ user, accessToken }));
        else localStorage.removeItem(KEY);
    } catch {
        // storage unavailable
    }
    listeners.forEach((fn) => fn(user));
}

export function onSessionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
