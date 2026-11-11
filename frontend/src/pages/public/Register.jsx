import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { api } from "../../api/index.js";
import { errorText } from "../../utils/errors.js";
import { TextField, useToast } from "../../components/ui.jsx";

export default function Register() {
    const { L, t, lang } = useI18n();
    const { login } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api.auth.register(form);
            await login(form.email, form.password);
            toast(L("สมัครสมาชิกเรียบร้อย", "Account created"));
            navigate("/book");
        } catch (err) {
            setError(errorText(err, lang));
        } finally {
            setBusy(false);
        }
    }

    return (
        <form className="panel stack" style={{ maxWidth: 480 }} onSubmit={submit} noValidate>
            <h1>{L("สมัครสมาชิก", "Create an account")}</h1>
            <p className="muted small">{L("ใช้บัญชีนี้จองคิว อนุมัติราคา และติดตามงานซ่อม", "Use it to book, approve quotations and track repairs.")}</p>
            <TextField label={L("ชื่อ-นามสกุล", "Full name")} autoComplete="name" value={form.full_name} onChange={set("full_name")} required />
            <TextField label={L("อีเมล", "Email")} type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
            <TextField label={L("เบอร์โทร", "Phone")} type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} hint={L("ร้านจะโทรแจ้งเมื่อซ่อมเสร็จ", "We call when your device is ready")} />
            <TextField label={L("รหัสผ่าน", "Password")} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} hint={L("อย่างน้อย 8 ตัวอักษร", "At least 8 characters")} required />
            {error && <div className="notice error" role="alert">{error}</div>}
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? t("common.loading") : L("สมัครสมาชิก", "Create account")}</button>
            <p className="small muted">{L("มีบัญชีแล้ว?", "Already have an account?")} <Link to="/login">{L("เข้าสู่ระบบ", "Sign in")}</Link></p>
        </form>
    );
}
