import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, Modal, PageHead, useAction } from "../../components/ui.jsx";
import "./admin.css";

const PAGE_SIZE = 20;
// One account has exactly one role. Admins can switch an account between these
// two; ADMIN is set in the database and can't be changed here.
const EDITABLE_ROLES = ["CUSTOMER", "TECHNICIAN"];
const ROLE_TONE = { CUSTOMER: "tone-blue", TECHNICIAN: "tone-green", ADMIN: "tone-amber" };

function StatusBadge({ status }) {
    const { L } = useI18n();
    if (status === "ACTIVE") return <span className="badge tone-green">{L("ใช้งานได้", "Active")}</span>;
    if (status === "LOCKED") return <span className="badge tone-red">{L("ถูกล็อก", "Locked")}</span>;
    return <span className="badge tone-grey">{L("ปิดอยู่", "Disabled")}</span>;
}

export default function AdminUsers() {
    const { L, t } = useI18n();
    const { user: me } = useAuth();
    const [role, setRole] = useState("");
    const [status, setStatus] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [editing, setEditing] = useState(null); // user whose role is being changed
    const [picked, setPicked] = useState("");
    const [run, busy] = useAction();

    // Search after the admin stops typing, and go back to page 1 on any filter change.
    useEffect(() => {
        const id = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(id);
    }, [searchInput]);
    useEffect(() => setPage(1), [role, status, search]);

    const list = useAsync(
        () => api.staff.listUsers({ role, status, search, page, pageSize: PAGE_SIZE }),
        [role, status, search, page]
    );

    const isMe = (u) => u.user_id === me?.user_id;

    async function changeStatus(u) {
        if (u.status === "LOCKED") {
            await run(() => api.staff.unlock(u.user_id), L("ปลดล็อกบัญชีแล้ว", "Account unlocked")).catch(() => null);
        } else {
            const active = u.status !== "ACTIVE";
            if (!active && !window.confirm(L(`ปิดบัญชีของ ${u.full_name}? เจ้าของบัญชีจะเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใหม่`, `Disable ${u.full_name}? They won't be able to sign in until you enable the account again.`))) return;
            await run(
                () => api.staff.setStatus(u.user_id, active),
                active ? L("เปิดใช้บัญชีแล้ว", "Account enabled") : L("ปิดบัญชีแล้ว", "Account disabled")
            ).catch(() => null);
        }
        list.reload();
    }

    function openRoles(u) {
        setPicked(u.roles.length === 1 && EDITABLE_ROLES.includes(u.roles[0]) ? u.roles[0] : "");
        setEditing(u);
    }

    const isAdmin = editing?.roles.includes("ADMIN");
    // Older accounts may still hold two roles; saving leaves them with just one.
    const unchanged = editing && editing.roles.length === 1 && editing.roles[0] === picked;

    async function saveRole() {
        const ok = await run(
            () => api.staff.setRole(editing.user_id, picked),
            L(`เปลี่ยนเป็น${t(`role.${picked}`)}แล้ว`, `Changed to ${t(`role.${picked}`)}`)
        ).then(() => true).catch(() => false);
        if (ok) setEditing(null);
        list.reload();
    }

    const data = list.data;
    const users = data?.items || [];
    const pg = data?.pagination;

    return (
        <div>
            <PageHead
                title={L("ผู้ใช้ทั้งหมด", "All users")}
                lede={L("ดูบัญชีลูกค้า ช่าง และผู้ดูแล เปิด/ปิดบัญชี และเปลี่ยนบทบาท (1 บัญชีมี 1 บทบาท)", "See every account, enable or disable it, and change its role (one role per account).")}
            />

            <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
                {["", "CUSTOMER", "TECHNICIAN", "ADMIN"].map((r) => (
                    <button key={r || "all"} type="button" role="tab" className="tab" aria-selected={role === r} onClick={() => setRole(r)}>
                        {r ? t(`role.${r}`) : t("common.all")}
                    </button>
                ))}
            </div>

            <div className="filters">
                <label className="field">
                    <span className="field-label">{L("ค้นหา", "Search")}</span>
                    <input className="input" type="search" placeholder={L("ชื่อ อีเมล หรือเบอร์โทร", "Name, email or phone")} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
                </label>
                <label className="field">
                    <span className="field-label">{L("สถานะ", "Status")}</span>
                    <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="">{t("common.all")}</option>
                        <option value="ACTIVE">{L("ใช้งานได้", "Active")}</option>
                        <option value="DISABLED">{L("ปิดอยู่", "Disabled")}</option>
                        <option value="LOCKED">{L("ถูกล็อก", "Locked")}</option>
                    </select>
                </label>
            </div>

            {list.loading && !data && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />

            {data && users.length === 0 && (
                <Empty title={L("ไม่พบบัญชีที่ตรงกับตัวกรอง", "No accounts match these filters")}>
                    {L("ลองเปลี่ยนคำค้นหรือเลือก “ทั้งหมด”", "Try another search or pick “All”.")}
                </Empty>
            )}

            {users.length > 0 && (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{L("ชื่อ", "Name")}</th>
                                <th>{L("อีเมล", "Email")}</th>
                                <th>{L("โทร", "Phone")}</th>
                                <th>{L("บทบาท", "Role")}</th>
                                <th>{L("สถานะ", "Status")}</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <tr key={u.user_id}>
                                    <td>{u.full_name}{isMe(u) && <span className="small faint"> ({L("คุณ", "you")})</span>}</td>
                                    <td className="num">{u.email}</td>
                                    <td className="num muted">{u.phone || "—"}</td>
                                    <td>
                                        <div className="role-chips">
                                            {u.roles.map((r) => <span key={r} className={`badge ${ROLE_TONE[r] || "tone-grey"}`}>{t(`role.${r}`)}</span>)}
                                        </div>
                                    </td>
                                    <td><StatusBadge status={u.status} /></td>
                                    <td className="right">
                                        {!isMe(u) && (
                                            <div className="btn-row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                                                {!u.roles.includes("ADMIN") && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openRoles(u)}>{L("เปลี่ยนบทบาท", "Change role")}</button>}
                                                <button type="button" className={`btn btn-sm ${u.status === "ACTIVE" ? "btn-danger" : "btn-secondary"}`} disabled={busy} onClick={() => changeStatus(u)}>
                                                    {u.status === "ACTIVE" ? L("ปิดบัญชี", "Disable") : u.status === "LOCKED" ? L("ปลดล็อก", "Unlock") : L("เปิดใช้", "Enable")}
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {pg && pg.total > 0 && (
                <div className="pager">
                    <span className="small muted">
                        {L(`ทั้งหมด ${pg.total} บัญชี · หน้า ${pg.page} จาก ${Math.max(1, pg.total_pages)}`, `${pg.total} accounts · page ${pg.page} of ${Math.max(1, pg.total_pages)}`)}
                    </span>
                    <div className="btn-row">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1 || list.loading} onClick={() => setPage((p) => p - 1)}>{L("ก่อนหน้า", "Previous")}</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pg.total_pages || list.loading} onClick={() => setPage((p) => p + 1)}>{L("ถัดไป", "Next")}</button>
                    </div>
                </div>
            )}

            {editing && (
                <Modal
                    title={L(`บทบาทของ ${editing.full_name}`, `Role for ${editing.full_name}`)}
                    onClose={() => setEditing(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-primary" disabled={busy || isAdmin || !picked || unchanged} onClick={saveRole}>{L("บันทึก", "Save")}</button>
                        </>
                    )}
                >
                    <div className="form-grid">
                        {!isAdmin && EDITABLE_ROLES.map((r) => (
                            <label key={r} className="role-option">
                                <input
                                    type="radio"
                                    name="account-role"
                                    checked={picked === r}
                                    onChange={() => setPicked(r)}
                                />
                                <span>
                                    <strong>{t(`role.${r}`)}</strong>
                                    <span className="small muted">
                                        {r === "CUSTOMER"
                                            ? L("แจ้งซ่อม เลือกตัวเลือกการซ่อม ชำระเงิน", "Request repairs, choose options, pay")
                                            : L("รับงานซ่อม วินิจฉัย เบิกอะไหล่", "Take repair jobs, diagnose, issue parts")}
                                    </span>
                                </span>
                            </label>
                        ))}
                        {isAdmin && (
                            <p className="small muted" style={{ margin: 0 }}>
                                {L("บัญชีนี้เป็นผู้ดูแลร้าน เปลี่ยนบทบาทจากหน้านี้ไม่ได้", "This account is a shop admin. Its role can't be changed here.")}
                            </p>
                        )}
                        {!isAdmin && editing.roles.length > 1 && (
                            <div className="notice warn small">{L("บัญชีนี้มีหลายบทบาทจากระบบเดิม เลือกบทบาทเดียวที่ต้องการเก็บไว้", "This older account has several roles. Pick the one to keep.")}</div>
                        )}
                        <p className="small faint" style={{ margin: 0 }}>
                            {L("1 บัญชีมีได้ 1 บทบาท บทบาทเดิมจะถูกแทนที่ และมีผลเมื่อเจ้าของบัญชีเข้าสู่ระบบครั้งถัดไป", "One account has one role. The old role is replaced; the change applies the next time the person signs in.")}
                        </p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
