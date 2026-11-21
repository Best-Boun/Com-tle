import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, PageHead } from "../../components/ui.jsx";
import { notificationText } from "../../utils/serverText.js";

/** Task 13: what the shop told the customer. Opening the page marks them read. */
export default function MyNotifications() {
    const { L, fmt, lang } = useI18n();
    const list = useAsync(() => api.notifications.listMine(), []);
    const marked = useRef(false);

    useEffect(() => {
        if (marked.current || !list.data || list.data.unread === 0) return;
        marked.current = true;
        api.notifications.markRead().catch(() => {});
    }, [list.data]);

    if (list.loading && !list.data) return <Loading />;
    if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
    const { items } = list.data;

    return (
        <div className="stack-lg">
            <PageHead
                title={L("การแจ้งเตือน", "Notifications")}
                lede={L("ร้านแจ้งความคืบหน้างานซ่อมที่นี่ และส่งทางอีเมลด้วยถ้ามีอีเมลในบัญชี", "Repair updates from the shop. They are also emailed when your account has an email.")}
            />
            {items.length === 0 ? (
                <Empty title={L("ยังไม่มีการแจ้งเตือน", "No notifications yet")}>
                    {L("เมื่อร้านรับเครื่องหรือมีความคืบหน้า จะแจ้งที่นี่", "You'll see updates here once the shop has your device.")}
                </Empty>
            ) : (
                <ul className="notice-list">
                    {items.map((n) => (
                        <li key={n.notification_id}>
                            <Link to={n.work_order_id ? `/my/repairs/${n.work_order_id}` : "/my/repairs"} className={`notice-item ${n.read_at ? "" : "is-unread"}`}>
                                <strong>{notificationText(n, lang).title}</strong>
                                <span className="small">{notificationText(n, lang).message}</span>
                                <span className="faint small">{fmt.dateTime(n.created_at)}{n.read_at ? "" : ` · ${L("ใหม่", "New")}`}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
