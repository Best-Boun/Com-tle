import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/index.js";
import { getSessionUser, onSessionChange } from "../api/session.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(getSessionUser);

    useEffect(() => onSessionChange(setUser), []);

    const value = useMemo(() => ({
        user,
        role: user?.roles?.[0] || null,
        login: (email, password) => api.auth.login({ email, password }),
        logout: () => api.auth.logout()
    }), [user]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}

/** Where each role lands after signing in. */
export function homeFor(role) {
    if (role === "ADMIN") return "/admin";
    if (role === "TECHNICIAN") return "/tech";
    return "/my/bookings";
}
