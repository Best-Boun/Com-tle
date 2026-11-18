import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "./icons.jsx";

/** Sign-in / sign-up frame: circuit-board panel on the left, the form on the right. */
export default function AuthShell({ children }) {
    const { L } = useI18n();
    const points = [
        { icon: Icon.Calendar, th: "แจ้งอาการไว้ล่วงหน้า แล้วนำเครื่องมาเมื่อสะดวก", en: "Tell us first, bring it in when it suits you" },
        { icon: Icon.Clipboard, th: "ดูผลตรวจและอนุมัติใบเสนอราคาเอง", en: "See the diagnosis, approve the quote" },
        { icon: Icon.Wrench, th: "ติดตามทุกขั้นจนรับเครื่อง", en: "Follow every step until pickup" }
    ];
    return (
        <div className="auth-shell">
            <aside className="auth-aside board-surface">
                <h2>{L("ทุกงานซ่อมของคุณ อยู่ในบัญชีเดียว", "Every repair of yours, in one account")}</h2>
                <ul>
                    {points.map((p) => (
                        <li key={p.en}><span><p.icon /></span>{L(p.th, p.en)}</li>
                    ))}
                </ul>
            </aside>
            <div className="auth-main">{children}</div>
        </div>
    );
}
