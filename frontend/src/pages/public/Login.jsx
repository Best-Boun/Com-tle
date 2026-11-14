import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { homeFor, useAuth } from "../../auth/AuthProvider.jsx";
import { api, USING_MOCK } from "../../api/index.js";
import { errorText } from "../../utils/errors.js";
import { TextField } from "../../components/ui.jsx";
import "./home.css";

export default function Login() {
    const { L, t, lang } = useI18n();
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    async function signIn(e, creds) {
        e?.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const { user } = await login(creds?.email ?? email, creds?.password ?? password);
            const role = user.roles[0];
            const from = location.state?.from;
            navigate(from && role === "CUSTOMER" ? from : homeFor(role), { replace: true });
        } catch (err) {
            setError(errorText(err, lang));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="auth-wrap">
            <form className="panel stack" onSubmit={signIn} noValidate>
                <h1>{L("เข้าสู่ระบบ", "Sign in")}</h1>
                {location.state?.from && <div className="notice info">{L("เข้าสู่ระบบก่อนเพื่อจองคิวและติดตามงานซ่อม", "Sign in to book and track your repairs.")}</div>}
                <TextField label={L("อีเมล", "Email")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <TextField label={L("รหัสผ่าน", "Password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                {error && <div className="notice error" role="alert">{error}</div>}
                <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? t("common.loading") : L("เข้าสู่ระบบ", "Sign in")}</button>
                <p className="small muted">{L("ยังไม่มีบัญชี?", "No account yet?")} <Link to="/register">{L("สมัครสมาชิก", "Create one")}</Link></p>
            </form>

            {/* Demo accounts exist only in the mock backend; hide them when auth is real. */}
            {USING_MOCK && <section className="stack">
                <h2>{L("ทดลองใช้ด้วยบัญชีตัวอย่าง", "Try a demo account")}</h2>
                <p className="muted small">
                    {L("ตอนนี้หน้าเว็บใช้ข้อมูลตัวอย่าง กดเพื่อเข้าดูหน้าของแต่ละบทบาทได้เลย (รหัสผ่าน ", "The site runs on demo data. Pick a role to see its screens (password ")}
                    <code>{api.demo.password}</code>)
                </p>
                <div className="demo-accounts">
                    {api.demo.accounts.map((a) => (
                        <button key={a.role} type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => signIn(null, { email: a.email, password: api.demo.password })}>
                            <span>{t(`role.${a.role}`)}</span>
                            <span className="faint small">{a.email}</span>
                        </button>
                    ))}
                </div>
            </section>}
        </div>
    );
}
