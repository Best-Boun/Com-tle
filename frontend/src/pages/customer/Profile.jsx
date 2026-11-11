import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { api } from "../../api/index.js";
import { PageHead, TextField, useAction } from "../../components/ui.jsx";

export default function Profile() {
    const { L, t } = useI18n();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ full_name: user.full_name, phone: user.phone || "" });
    const [run, busy] = useAction();

    async function save(e) {
        e.preventDefault();
        await run(() => api.auth.updateProfile(form), L("บันทึกข้อมูลแล้ว", "Profile saved")).catch(() => null);
    }

    return (
        <div style={{ maxWidth: 520 }}>
            <PageHead title={L("ข้อมูลของฉัน", "My profile")} />
            <form className="panel stack" onSubmit={save}>
                <TextField label={L("อีเมล", "Email")} value={user.email} disabled hint={L("เปลี่ยนอีเมลไม่ได้", "Email can't be changed")} />
                <TextField label={L("ชื่อ-นามสกุล", "Full name")} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
                <TextField label={L("เบอร์โทร", "Phone")} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <div className="btn-row">
                    <button type="submit" className="btn btn-primary" disabled={busy}>{L("บันทึกข้อมูล", "Save profile")}</button>
                    <button type="button" className="btn btn-secondary" onClick={async () => { await logout(); navigate("/"); }}>{t("common.signout")}</button>
                </div>
            </form>
        </div>
    );
}
