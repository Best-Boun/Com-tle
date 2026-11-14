import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { homeFor, useAuth } from "../auth/AuthProvider.jsx";
import { api, USING_MOCK } from "../api/index.js";
import { BrandMark, Icon } from "./icons.jsx";

export function LangToggle({ className = "btn btn-ghost btn-sm" }) {
    const { lang, setLang } = useI18n();
    const next = lang === "th" ? "en" : "th";
    return (
        <button type="button" className={className} onClick={() => setLang(next)} aria-label={lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}>
            <Icon.Globe />
            {lang === "th" ? "EN" : "ไทย"}
        </button>
    );
}

function useCloseOnNavigate(setOpen) {
    const location = useLocation();
    useEffect(() => setOpen(false), [location.pathname, setOpen]);
}

/* ---------- Public + customer: top bar ---------- */
export function PublicLayout() {
    const { L, t } = useI18n();
    const { user, role, logout } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    useCloseOnNavigate(setOpen);

    const isCustomer = role === "CUSTOMER";

    async function signOut() {
        await logout();
        navigate("/");
    }

    return (
        <>
            <header className="topbar">
                <div className="topbar-inner">
                    <Link to="/" className="brand"><BrandMark />SmartFix</Link>
                    <nav className={`topnav ${open ? "open" : ""}`} aria-label={L("เมนูหลัก", "Main")}>
                        <NavLink to="/services">{L("บริการและราคา", "Services & prices")}</NavLink>
                        {isCustomer && (
                            <>
                                <NavLink to="/book">{L("จองคิวซ่อม", "Book a repair")}</NavLink>
                                <NavLink to="/my/bookings">{L("การจองของฉัน", "My bookings")}</NavLink>
                                <NavLink to="/my/repairs">{L("ติดตามงานซ่อม", "Track repairs")}</NavLink>
                                <NavLink to="/my/payments">{L("การชำระเงิน", "Payments")}</NavLink>
                            </>
                        )}
                        {user && !isCustomer && <NavLink to={homeFor(role)}>{L("ไปหน้าทำงาน", "Go to workspace")}</NavLink>}
                    </nav>
                    <div className="topbar-actions">
                        <LangToggle />
                        {user ? (
                            <>
                                {isCustomer && <Link to="/my/profile" className="btn btn-ghost btn-sm hide-sm"><Icon.User />{user.full_name.split(" ")[0]}</Link>}
                                <button type="button" className="btn btn-secondary btn-sm hide-sm" onClick={signOut}>{t("common.signout")}</button>
                            </>
                        ) : (
                            <>
                                <Link to="/login" className="btn btn-ghost btn-sm hide-sm">{L("เข้าสู่ระบบ", "Sign in")}</Link>
                                <Link to="/book" className="btn btn-primary btn-sm">{L("จองคิว", "Book")}</Link>
                            </>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm menu-toggle" aria-expanded={open} aria-label={L("เมนู", "Menu")} onClick={() => setOpen((v) => !v)}>
                            <Icon.Menu />
                        </button>
                    </div>
                </div>
            </header>
            <main className="page" id="main">
                <Outlet />
            </main>
            <Footer />
        </>
    );
}

function Footer() {
    const { L } = useI18n();
    const navigate = useNavigate();
    async function reset() {
        if (!window.confirm(L("ล้างข้อมูลตัวอย่างทั้งหมดและเริ่มใหม่?", "Reset all demo data and start over?"))) return;
        await api.demo.reset();
        navigate("/");
        window.location.reload();
    }
    return (
        <footer className="footer">
            <div className="footer-inner">
                <span>SmartFix · {L("ร้านซ่อมคอมพิวเตอร์ เปิด 09:00–17:00 ทุกวัน", "Computer repair, open daily 09:00–17:00")}</span>
                <span>
                    {USING_MOCK
                        ? L("ตอนนี้ใช้ข้อมูลตัวอย่าง (ยังไม่ต่อ API)", "Using demo data (API not connected yet)")
                        : L("บัญชีและโปรไฟล์ใช้ API จริง ส่วนอื่นยังเป็นข้อมูลตัวอย่าง", "Accounts and profile use the real API; other pages use demo data")}{" "}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>{L("รีเซ็ตข้อมูลตัวอย่าง", "Reset demo data")}</button>
                </span>
            </div>
        </footer>
    );
}

/* ---------- Technician + admin: sidebar ---------- */
const STAFF_NAV = {
    ADMIN: [
        { to: "/admin", end: true, icon: Icon.Dashboard, th: "ภาพรวมวันนี้", en: "Today" },
        { to: "/admin/bookings", icon: Icon.Calendar, th: "การจอง", en: "Bookings" },
        { to: "/admin/work-orders", icon: Icon.Wrench, th: "ใบงานซ่อม", en: "Work orders" },
        { to: "/admin/catalog", icon: Icon.Tag, th: "บริการและราคา", en: "Services & prices" },
        { to: "/admin/inventory", icon: Icon.Box, th: "คลังอะไหล่", en: "Parts stock" },
        { to: "/admin/payments", icon: Icon.Cash, th: "การเงิน", en: "Payments" }
    ],
    TECHNICIAN: [
        { to: "/tech", end: true, icon: Icon.Clipboard, th: "งานของฉัน", en: "My jobs" },
        { to: "/tech/parts", icon: Icon.Box, th: "อะไหล่ในร้าน", en: "Parts in stock" }
    ]
};

export function StaffLayout() {
    const { L, t } = useI18n();
    const { user, role, logout } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    useCloseOnNavigate(setOpen);

    async function signOut() {
        await logout();
        navigate("/login");
    }

    return (
        <div className="shell">
            <div className="shell-mobilebar">
                <Link to={homeFor(role)} className="brand"><BrandMark light />SmartFix</Link>
                <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-label={L("เมนู", "Menu")} onClick={() => setOpen((v) => !v)}>
                    <Icon.Menu />
                </button>
            </div>
            <aside className={`sidebar ${open ? "open" : ""}`}>
                <Link to={homeFor(role)} className="brand"><BrandMark light />SmartFix</Link>
                <div className="sidebar-role">{user?.full_name} · {t(`role.${role}`)}</div>
                <nav className="sidenav" aria-label={L("เมนูพนักงาน", "Staff")}>
                    {(STAFF_NAV[role] || []).map((item) => (
                        <NavLink key={item.to} to={item.to} end={item.end}>
                            <item.icon />
                            {L(item.th, item.en)}
                        </NavLink>
                    ))}
                </nav>
                <div className="sidebar-foot">
                    <LangToggle className="btn btn-ghost btn-sm" />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}><Icon.Logout />{t("common.signout")}</button>
                </div>
            </aside>
            <main className="workarea" id="main">
                <Outlet />
            </main>
        </div>
    );
}
