/**
 * Real auth implementation through the API Gateway (/api/users/*).
 * Same function names and return shapes as ../mock auth so pages don't change.
 */
import { ApiError } from "../mock/db.js";
import { getSessionUser, setSessionUser } from "../session.js";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000/api").replace(/\/$/, "");
const REFRESH_KEY = "smartfix-refresh-token";
const TOKEN_KEY = "smartfix-session";

const MESSAGES = {
    401: { th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง", en: "Invalid email or password" },
    403: { th: "คุณไม่มีสิทธิ์ทำรายการนี้", en: "You do not have permission" },
    409: { th: "อีเมลนี้มีบัญชีอยู่แล้ว", en: "An account with this email already exists" },
    429: { th: "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่", en: "Too many login attempts" }
};

function accessToken() {
    try {
        return JSON.parse(localStorage.getItem(TOKEN_KEY))?.accessToken || null;
    } catch {
        return null;
    }
}

function storeRefreshToken(token) {
    try {
        if (token) localStorage.setItem(REFRESH_KEY, token);
        else localStorage.removeItem(REFRESH_KEY);
    } catch {
        // storage unavailable
    }
}

function readRefreshToken() {
    try {
        return localStorage.getItem(REFRESH_KEY);
    } catch {
        return null;
    }
}

async function request(path, { method = "GET", body, auth = false } = {}) {
    const headers = { "content-type": "application/json" };
    if (auth) {
        const token = accessToken();
        if (token) headers.authorization = `Bearer ${token}`;
    }
    let response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        throw new ApiError({ th: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", en: "Cannot reach the server" }, 503);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
        const en = payload?.message || `Request failed (${response.status})`;
        const known = MESSAGES[response.status];
        throw new ApiError(known && response.status !== 403 ? known : { th: known?.th || en, en }, response.status);
    }
    return payload?.data;
}

function toSessionUser(user, roles, fullName) {
    return {
        user_id: user.user_id,
        email: user.email,
        phone: user.phone ?? null,
        full_name: fullName || user.full_name || user.email,
        roles
    };
}

export const auth = {
    async login({ email, password }) {
        const data = await request("/users/auth/login", {
            method: "POST",
            body: { email, password }
        });
        storeRefreshToken(data.refresh_token);
        let user = toSessionUser(data.user, data.roles);
        setSessionUser(user, data.access_token);
        // Login does not return the display name; load it from the profile.
        // Missing permission or customer row (403/404) keeps the email instead.
        try {
            const profile = await request("/users/users/me", { auth: true });
            user = toSessionUser(data.user, data.roles, profile?.full_name);
            setSessionUser(user, data.access_token);
        } catch {
            // keep the email as the display name
        }
        return { user, accessToken: data.access_token };
    },

    async register({ full_name, email, password, phone }) {
        const data = await request("/users/auth/register", {
            method: "POST",
            body: { full_name, email, password, phone: phone?.trim() || null }
        });
        return { user: toSessionUser(data.user, data.roles, data.user.full_name) };
    },

    async logout() {
        const refreshToken = readRefreshToken();
        try {
            if (refreshToken) {
                await request("/users/auth/logout", {
                    method: "POST",
                    body: { refresh_token: refreshToken }
                });
            }
        } finally {
            storeRefreshToken(null);
            setSessionUser(null);
        }
        return null;
    },

    async updateProfile({ full_name, phone }) {
        const data = await request("/users/users/me", {
            method: "PATCH",
            auth: true,
            body: { full_name, phone: phone?.trim() || null }
        });
        const current = getSessionUser();
        const user = toSessionUser(data, data.roles || current?.roles || [], data.full_name);
        setSessionUser(user, accessToken());
        return user;
    },

    async listTechnicians() {
        const data = await request("/users/admin/users?role=TECHNICIAN&limit=100", { auth: true });
        return data.items;
    }
};
