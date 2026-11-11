import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DICT } from "./dictionary.js";

const I18nContext = createContext(null);
const KEY = "smartfix-lang";
const TZ = "Asia/Bangkok";

function initialLang() {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved === "th" || saved === "en") return saved;
    } catch {
        // ignore
    }
    return "th";
}

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(initialLang);

    useEffect(() => {
        document.documentElement.lang = lang;
        try {
            localStorage.setItem(KEY, lang);
        } catch {
            // ignore
        }
    }, [lang]);

    /** Inline copy: L("ไทย", "English") */
    const L = useCallback((th, en) => (lang === "th" ? th : en), [lang]);

    /** Shared vocabulary from the dictionary: t("status.booking.PENDING") */
    const t = useCallback((key) => DICT[lang][key] ?? DICT.en[key] ?? key, [lang]);

    const locale = lang === "th" ? "th-TH" : "en-GB";

    const fmt = useMemo(() => ({
        money: (value, currency = "THB") =>
            new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value) || 0),
        number: (value) => new Intl.NumberFormat(locale).format(Number(value) || 0),
        date: (iso) => (iso ? new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "—"),
        dateLong: (iso) => (iso ? new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)) : "—"),
        time: (iso) => (iso ? new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—"),
        dateTime: (iso) => (iso ? new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—"),
        /** "YYYY-MM-DD" (shop-local) -> readable day */
        day: (ymd, opts = { weekday: "short", day: "numeric", month: "short" }) =>
            new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(new Date(`${ymd}T00:00:00Z`))
    }), [locale]);

    const value = useMemo(() => ({ lang, setLang, L, t, fmt }), [lang, L, t, fmt]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
    return ctx;
}
