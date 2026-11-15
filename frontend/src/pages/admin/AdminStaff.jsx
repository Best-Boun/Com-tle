import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, Modal, PageHead, TextField, useAction } from "../../components/ui.jsx";
import "./admin.css";

const EMPTY_FORM = { full_name: "", email: "", phone: "", password: "" };

/** 10 characters without look-alikes (0/O, 1/l/I) so it's easy to read out to the technician. */
function randomPassword() {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export default function AdminStaff() {
    const { L, t } = useI18n();
    const { user: me } = useAuth();
    const list = useAsync(() => api.staff.list(), []);
    const [run, busy] = useAction();
    const [mode, setMode] = useState(null); // null | "new" | "existing"
    const [form, setForm] = useState(EMPTY_FORM);
    const [existingEmail, setExistingEmail] = useState("");
    const [created, setCreated] = useState(null); // { email, password } shown once after creating

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    function open(nextMode) {
        setForm({ ...EMPTY_FORM, password: randomPassword() });
        setExistingEmail("");
        setMode(nextMode);
    }

    async function save() {
        if (mode === "new") {
            const result = await run(() => api.staff.createTechnician(form), L("สร้างบัญชีช่างแล้ว", "Technician account created")).catch(() => null);
            if (!result) return;
            setCreated({ name: result.full_name, email: result.email, password: form.password });
        } else {
            const result = await run(() => api.staff.promoteByEmail(existingEmail), L("ตั้งเป็นช่างแล้ว", "Now a technician")).catch(() => null);
            if (!result) return;
        }
        setMode(null);
        list.reload();
    }

    async function toggle(person) {
        const active = person.status !== "ACTIVE";
        await run(
            () => api.staff.setStatus(person.user_id, active),
            active ? L("เปิดใช้บัญชีแล้ว", "Account enabled") : L("ปิดบัญชีแล้ว ช่างคนนี้เข้าสู่ระบบไม่ได้", "Account disabled — this technician can't sign in")
        ).catch(() => null);
        list.reload();
    }

    const people = list.data || [];

    return (
        <div>
            <PageHead
                title={L("บัญชีช่าง", "Technician accounts")}
                lede={L(
                    "สร้างบัญชีให้ช่าง แล้วส่งอีเมลกับรหัสผ่านให้เขา ช่างเข้าสู่ระบบที่หน้าเดียวกับลูกค้า ระบบจะพาไปหน้างานของช่างเอง",
                    "Create an account for a technician and hand them the email and password. They sign in on the normal login page and land on the technician screens."
                )}
                actions={(
                    <div className="btn-row">
                        <button type="button" className="btn btn-secondary" onClick={() => open("existing")}>{L("ตั้งบัญชีที่มีอยู่เป็นช่าง", "Use an existing account")}</button>
                        <button type="button" className="btn btn-primary" onClick={() => open("new")}>{L("เพิ่มบัญชีช่าง", "Add technician")}</button>
                    </div>
                )}
            />

            {created && (
                <div className="notice ok" role="status" style={{ marginBottom: 16 }}>
                    <div>
                    <strong>{L(`บัญชีของ ${created.name} พร้อมใช้แล้ว`, `${created.name}'s account is ready`)}</strong>
                    <div className="small" style={{ marginTop: 6 }}>
                        {L("อีเมล", "Email")}: <span className="num">{created.email}</span><br />
                        {L("รหัสผ่าน", "Password")}: <span className="num">{created.password}</span>
                    </div>
                    <div className="small muted" style={{ marginTop: 6 }}>
                        {L("จดหรือส่งให้ช่างตอนนี้ รหัสผ่านจะไม่แสดงอีกเมื่อออกจากหน้านี้", "Note it down or send it now — the password won't be shown again.")}
                    </div>
                    <div className="btn-row" style={{ marginTop: 8 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(`${created.email}\n${created.password}`)}>{L("คัดลอก", "Copy")}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>{L("ปิด", "Dismiss")}</button>
                    </div>
                    </div>
                </div>
            )}

            {list.loading && !list.data && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />

            {list.data && people.length === 0 && (
                <Empty title={L("ยังไม่มีบัญชีช่าง", "No technician accounts yet")}>
                    {L("กด “เพิ่มบัญชีช่าง” เพื่อสร้างบัญชีแรก", "Use “Add technician” to create the first one.")}
                </Empty>
            )}

            {people.length > 0 && (
                <div className="table-wrap">
                    <table className="table">
                        <thead><tr><th>{L("ชื่อ", "Name")}</th><th>{L("อีเมลเข้าสู่ระบบ", "Sign-in email")}</th><th>{L("โทร", "Phone")}</th><th>{L("สถานะ", "Status")}</th><th /></tr></thead>
                        <tbody>
                            {people.map((p) => (
                                <tr key={p.user_id}>
                                    <td>{p.full_name}</td>
                                    <td className="num">{p.email}</td>
                                    <td className="num muted">{p.phone || "—"}</td>
                                    <td>{p.status === "ACTIVE"
                                        ? <span className="badge tone-green">{L("ใช้งานได้", "Active")}</span>
                                        : <span className="badge tone-grey">{p.status === "LOCKED" ? L("ถูกล็อก", "Locked") : L("ปิดอยู่", "Disabled")}</span>}
                                    </td>
                                    <td className="right">
                                        {p.user_id !== me?.user_id && (
                                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(p)}>
                                                {p.status === "ACTIVE" ? L("ปิดบัญชี", "Disable") : L("เปิดใช้", "Enable")}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {mode && (
                <Modal
                    title={mode === "new" ? L("เพิ่มบัญชีช่าง", "Add technician") : L("ตั้งบัญชีที่มีอยู่เป็นช่าง", "Use an existing account")}
                    onClose={() => setMode(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setMode(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                                {mode === "new" ? L("สร้างบัญชี", "Create account") : L("ตั้งเป็นช่าง", "Make technician")}
                            </button>
                        </>
                    )}
                >
                    {mode === "new" ? (
                        <div className="form-grid">
                            <TextField label={L("ชื่อ-นามสกุล", "Full name")} value={form.full_name} onChange={set("full_name")} autoComplete="off" />
                            <div className="form-grid two">
                                <TextField type="email" label={L("อีเมล (ใช้เข้าสู่ระบบ)", "Email (for sign-in)")} value={form.email} onChange={set("email")} autoComplete="off" />
                                <TextField type="tel" label={L("เบอร์โทร", "Phone")} value={form.phone} onChange={set("phone")} hint={L("ไม่บังคับ", "Optional")} />
                            </div>
                            <TextField
                                label={L("รหัสผ่านเริ่มต้น", "Starting password")}
                                value={form.password}
                                onChange={set("password")}
                                autoComplete="new-password"
                                hint={L("อย่างน้อย 8 ตัว ระบบสุ่มให้แล้ว แก้ได้", "At least 8 characters. Pre-filled with a random one you can change.")}
                            />
                            <div>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, password: randomPassword() }))}>{L("สุ่มรหัสใหม่", "New random password")}</button>
                            </div>
                        </div>
                    ) : (
                        <div className="form-grid">
                            <p className="muted small" style={{ margin: 0 }}>
                                {L(
                                    "ใช้เมื่อช่างสมัครสมาชิกเองไว้แล้ว ระบบจะเปลี่ยนบัญชีนั้นจากลูกค้าเป็นช่าง รหัสผ่านเดิมใช้ได้ต่อ",
                                    "For a technician who already signed up. The account changes from customer to technician and keeps its password."
                                )}
                            </p>
                            <TextField type="email" label={L("อีเมลของบัญชี", "Account email")} value={existingEmail} onChange={(e) => setExistingEmail(e.target.value)} />
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
