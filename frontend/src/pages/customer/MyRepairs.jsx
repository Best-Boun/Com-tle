import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, Money, PageHead } from "../../components/ui.jsx";
import Ticket from "../../components/Ticket.jsx";
import { deviceLabel } from "../../components/repair.jsx";

export default function MyRepairs() {
    const { L, fmt } = useI18n();
    const list = useAsync(() => api.repairs.listMine(), []);

    return (
        <div>
            <PageHead title={L("ติดตามงานซ่อม", "Track repairs")} lede={L("ใบงานจะขึ้นที่นี่เมื่อร้านรับเครื่องแล้ว", "A ticket appears here once the shop receives your device.")} />
            {list.loading && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data?.length === 0 && (
                <Empty title={L("ยังไม่มีงานซ่อม", "No repairs yet")} action={<Link to="/book" className="btn btn-primary">{L("จองคิวซ่อม", "Book a repair")}</Link>}>
                    {L("จองคิวแล้วนำเครื่องมาที่ร้าน แล้วติดตามความคืบหน้าได้ที่นี่", "Book, bring your device, then follow progress here.")}
                </Empty>
            )}
            <div className="ticket-list">
                {list.data?.map((w) => (
                    <Ticket
                        key={w.work_order_id}
                        to={`/my/repairs/${w.work_order_id}`}
                        number={w.work_order_number}
                        title={`${deviceLabel(w)} · ${w.service_name || ""}`}
                        meta={[`${L("รับเครื่อง", "Received")} ${fmt.date(w.created_at)}`, w.handed_over_at && L("ส่งมอบแล้ว", "Handed over")]}
                        kind="wo"
                        status={w.handed_over_at ? "HANDED_OVER" : w.status}
                        stub={w.payment.due > 0 && (
                            <span className="small muted">{L("ค้าง", "Due")} <Money value={w.payment.balance} /></span>
                        )}
                    />
                ))}
            </div>
        </div>
    );
}
