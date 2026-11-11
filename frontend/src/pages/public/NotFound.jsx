import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Empty } from "../../components/ui.jsx";

export default function NotFound() {
    const { L } = useI18n();
    return (
        <Empty
            title={L("ไม่พบหน้านี้", "Page not found")}
            action={<Link to="/" className="btn btn-primary">{L("กลับหน้าแรก", "Back to home")}</Link>}
        >
            {L("ลิงก์อาจพิมพ์ผิดหรือหน้านี้ถูกย้ายแล้ว", "The link may be mistyped or the page has moved.")}
        </Empty>
    );
}
