import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead, StatusBadge } from "../../components/ui.jsx";
import { Icon } from "../../components/icons.jsx";
import "./admin.css";

export default function Dashboard() {
    const { L, t, fmt } = useI18n();
    const data = useAsync(() => api.dashboard.summary(), []);

    if (data.loading && !data.data) return <Loading />;
    if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
    const d = data.data;

    const todo = [
        { count: d.bookings_overdue, to: "/admin/bookings?status=CONFIRMED", th: "เลยเวลานัด ยังไม่รับเครื่อง", en: "Past appointments not checked in" },
        { count: d.unassigned, to: "/admin/work-orders?status=OPEN", th: "ใบงานยังไม่มอบหมายช่าง", en: "Jobs without a technician" },
        { count: d.drafts_to_price, to: "/admin/work-orders?status=OPEN", th: "รายการที่ช่างเสนอ รอตั้งราคา", en: "Proposed items to price" },
        { count: d.ready_for_handover, to: "/admin/work-orders?status=READY", th: "ซ่อมเสร็จ รอส่งมอบ", en: "Ready for handover" },
        { count: d.low_stock.length, to: "/admin/inventory", th: "อะไหล่ใกล้หมด", en: "Parts running low" }
    ];

    return (
        <div className="stack-lg">
            <PageHead title={L("ภาพรวมวันนี้", "Today")} lede={fmt.dateLong(new Date().toISOString())} />

            <div className="kpi-row">
                <div className="kpi"><span className="kpi-icon"><Icon.Calendar /></span><span className="kpi-label">{L("นัดวันนี้", "Appointments today")}</span><strong className="num">{d.bookings_today}</strong></div>
                <div className="kpi"><span className="kpi-icon"><Icon.Wrench /></span><span className="kpi-label">{L("งานที่เปิดอยู่", "Open jobs")}</span><strong className="num">{d.open_work_orders}</strong></div>
                <div className="kpi"><span className="kpi-icon"><Icon.Clipboard /></span><span className="kpi-label">{L("รอลูกค้าอนุมัติ", "Awaiting customer")}</span><strong className="num">{d.waiting_approval}</strong></div>
                <div className="kpi kpi-money"><span className="kpi-icon"><Icon.Cash /></span><span className="kpi-label">{L("ยอดค้างชำระรวม", "Outstanding")}</span><strong className="num">{d.outstanding_total === null ? <span title={L("ระบบการเงินไม่พร้อมใช้งาน", "Payment system unavailable")}>—</span> : <Money value={d.outstanding_total} />}</strong>{d.outstanding_total === null && <span className="small faint">{L("ระบบการเงินไม่พร้อม", "Payments unavailable")}</span>}</div>
            </div>

            <div className="dash-grid">
                <section className="stack">
                    <h2>{L("ต้องจัดการ", "Needs attention")}</h2>
                    <ul className="todo-list">
                        {todo.map((x) => (
                            <li key={x.en} className={x.count > 0 ? "has" : ""}>
                                <Link to={x.to}>
                                    <span className="todo-count num">{x.count}</span>
                                    <span>{L(x.th, x.en)}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="stack">
                    <h2>{L("งานซ่อมแยกตามขั้นตอน", "Jobs by stage")}</h2>
                    <div className="status-bars panel" aria-label={L("งานแยกตามสถานะ", "Jobs by status")}>
                        {d.work_by_status.map((s) => (
                            <div key={s.status} className="status-bar">
                                <span className="small">{t(`status.wo.${s.status}`)}</span>
                                <span className="bar"><span style={{ width: `${Math.min(100, s.count * 20)}%` }} /></span>
                                <span className="num small">{s.count}</span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            <section className="stack">
                <div className="panel-head" style={{ marginBottom: 0 }}>
                    <h2>{L("นัดที่กำลังจะถึง", "Upcoming appointments")}</h2>
                    <Link to="/admin/bookings">{L("ดูการจองทั้งหมด", "All bookings")}</Link>
                </div>
                <div className="table-wrap">
                    <table className="table">
                        <thead><tr><th>{L("เวลา", "When")}</th><th>{L("ลูกค้า", "Customer")}</th><th>{L("บริการ", "Service")}</th><th>{L("สถานะ", "Status")}</th></tr></thead>
                        <tbody>
                            {d.upcoming.length === 0 && <tr><td colSpan={4} className="muted">{L("ไม่มีนัด", "No appointments")}</td></tr>}
                            {d.upcoming.map((b) => (
                                <tr key={b.booking_id}>
                                    <td className="num">{fmt.day(b.appointment_date)} · {b.appointment_time}</td>
                                    <td>{b.customer_name}</td>
                                    <td>{b.service_name}</td>
                                    <td><StatusBadge kind="booking" status={b.status} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {d.low_stock.length > 0 && (
                <section className="stack">
                    <h2>{L("อะไหล่ใกล้หมด", "Parts running low")}</h2>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                        {d.low_stock.map((p) => <li key={p.part_id}>{p.name} — {L("เหลือ", "left")} <strong className="num">{p.stock}</strong> ({L("ควรสั่งเมื่อเหลือ", "reorder at")} {p.reorder_level})</li>)}
                    </ul>
                </section>
            )}
        </div>
    );
}
