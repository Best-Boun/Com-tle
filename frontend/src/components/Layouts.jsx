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

/** Task 13: unread notifications for a signed-in customer, refreshed on every page change. */
function useUnreadCount(enabled) {
    const location = useLocation();
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        api.notifications.listMine()
            .then((data) => { if (live) setCount(data.unread); })
            .catch(() => {});
        return () => { live = false; };
    }, [enabled, location.pathname]);
    return count;
}

function NotificationBell() {
    const { L } = useI18n();
    const unread = useUnreadCount(true);
    const label = unread > 0
        ? L(`การแจ้งเตือน (ยังไม่อ่าน ${unread})`, `Notifications (${unread} unread)`)
        : L("การแจ้งเตือน", "Notifications");
    return (
        <Link to="/my/notifications" className="btn btn-ghost btn-sm bell" aria-label={label} title={label}>
            <Icon.Bell />
            {unread > 0 && <span className="bell-count num" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
        </Link>
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
                        <NavLink to="/team">{L("ทีมผู้พัฒนา", "Team")}</NavLink>
                        {isCustomer && (
                            <>
                                <NavLink to="/book">{L("แจ้งซ่อม", "Request a repair")}</NavLink>
                                <NavLink to="/my/bookings">{L("การแจ้งซ่อมของฉัน", "My requests")}</NavLink>
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
                                {isCustomer && <NotificationBell />}
                                {isCustomer && <Link to="/my/profile" className="btn btn-ghost btn-sm hide-sm"><Icon.User />{user.full_name.split(" ")[0]}</Link>}
                                <button type="button" className="btn btn-secondary btn-sm hide-sm" onClick={signOut}>{t("common.signout")}</button>
                            </>
                        ) : (
                            <>
                                <Link to="/login" className="btn btn-ghost btn-sm hide-sm">{L("เข้าสู่ระบบ", "Sign in")}</Link>
                                <Link to="/book" className="btn btn-primary btn-sm">{L("แจ้งซ่อม", "Request")}</Link>
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
        <footer className="footer board-surface">
            <div className="footer-inner">
                <div className="footer-cols">
                    <div>
                        <Link to="/" className="brand"><BrandMark light />SmartFix</Link>
                        <p>{L("ร้านซ่อมโน้ตบุ๊กและคอมพิวเตอร์ ตรวจเช็กก่อน แจ้งราคาก่อน แล้วค่อยซ่อม", "Laptop and computer repair. We check first, quote first, then repair.")}</p>
                    </div>
                    <div>
                        <h2>{L("ติดต่อร้าน", "Contact")}</h2>
                        <ul className="footer-list">
                            <li>{L("123 ถ.พหลโยธิน แขวงจตุจักร กรุงเทพฯ 10900", "123 Phahonyothin Rd, Chatuchak, Bangkok 10900")}</li>
                            <li><a href="tel:021234567">02-123-4567</a></li>
                        </ul>
                    </div>
                    <div>
                        <h2>{L("เวลาเปิด", "Opening hours")}</h2>
                        <ul className="footer-list">
                            <li>{L("ทุกวัน 09:00–17:00", "Daily 09:00–17:00")}</li>
                            <li>{L("พักเที่ยง 12:00–13:00", "Lunch 12:00–13:00")}</li>
                        </ul>
                    </div>
                </div>
                <div className="footer-bottom">
                    <span>© 2026 SmartFix development team · <Link to="/team">{L("ทีมผู้พัฒนา", "Team")}</Link> · MIT License</span>
                    <span>
                        {USING_MOCK
                            ? L("ตอนนี้ใช้ข้อมูลตัวอย่าง", "Running on demo data")
                            : L("เชื่อมต่อ API จริง", "Connected to the real API")}{" "}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>{L("รีเซ็ตข้อมูลตัวอย่าง", "Reset demo data")}</button>
                    </span>
                </div>
            </div>
        </footer>
    );
}

/* ---------- Technician + admin: sidebar ---------- */
const STAFF_NAV = {
    ADMIN: [
        { to: "/admin", end: true, icon: Icon.Dashboard, th: "ภาพรวมวันนี้", en: "Today" },
        { to: "/admin/bookings", icon: Icon.Calendar, th: "คำขอแจ้งซ่อม", en: "Repair requests" },
        { to: "/admin/work-orders", icon: Icon.Wrench, th: "ใบงานซ่อม", en: "Work orders" },
        { to: "/admin/catalog", icon: Icon.Tag, th: "บริการและราคา", en: "Services & prices" },
        { to: "/admin/inventory", icon: Icon.Box, th: "คลังอะไหล่", en: "Parts stock" },
        { to: "/admin/payments", icon: Icon.Cash, th: "การเงิน", en: "Payments" },
        { to: "/admin/users", icon: Icon.Users, th: "ผู้ใช้ทั้งหมด", en: "All users" },
        { to: "/admin/staff", icon: Icon.User, th: "บัญชีช่าง", en: "Technicians" }
    ],
    TECHNICIAN: [
        { to: "/tech", end: true, icon: Icon.Clipboard, th: "งานของฉัน", en: "My jobs" },
        { to: "/tech/queue", icon: Icon.Clipboard, th: "คิวงานรอช่าง", en: "Job queue" },
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
                <div className="sidebar-role"><strong>{user?.full_name}</strong>{t(`role.${role}`)}</div>
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
