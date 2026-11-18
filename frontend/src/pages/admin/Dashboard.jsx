import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead } from "../../components/ui.jsx";
import { Icon } from "../../components/icons.jsx";
import { deviceLine, symptomLabel } from "../../utils/requestLabels.js";
import "./admin.css";

export default function Dashboard() {
    const { L, t, fmt } = useI18n();
    const data = useAsync(() => api.dashboard.summary(), []);

    if (data.loading && !data.data) return <Loading />;
    if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
    const d = data.data;

    const todo = [
        { count: d.bookings_overdue, to: "/admin/bookings?status=PENDING", th: "คำขอเกิน 7 วัน ยังไม่นำเครื่องมา", en: "Requests waiting over 7 days" },
        { count: d.unassigned, to: "/admin/work-orders?status=OPEN", th: "ใบงานยังไม่มอบหมายช่าง", en: "Jobs without a technician" },
        { count: d.waiting_parts, to: "/admin/work-orders?status=WAITING_PARTS", th: "งานที่รออะไหล่", en: "Jobs waiting for parts" },
        { count: d.ready_for_handover, to: "/admin/work-orders?status=READY", th: "พร้อมรับเครื่อง รอส่งมอบ", en: "Ready for pickup" },
        { count: d.overdue_pickups.length, to: "/admin/work-orders?status=READY", th: "เกินเวลาเก็บฟรี ยังไม่มารับเครื่อง", en: "Not collected after free storage" },
        { count: d.low_stock.length, to: "/admin/inventory", th: "อะไหล่ใกล้หมด", en: "Parts running low" }
    ];

    return (
        <div className="stack-lg">
            <PageHead title={L("ภาพรวมวันนี้", "Today")} lede={fmt.dateLong(new Date().toISOString())} />

            <div className="kpi-row">
                <div className="kpi"><span className="kpi-icon"><Icon.Calendar /></span><span className="kpi-label">{L("คำขอแจ้งซ่อมวันนี้", "Repair requests today")}</span><strong className="num">{d.bookings_today}</strong></div>
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

            {d.overdue_pickups.length > 0 && (
                <section className="stack" id="overdue-pickups">
                    <h2>{L("โทรตามลูกค้าให้มารับเครื่อง", "Call these customers to collect")}</h2>
                    <p className="small muted">{L("เกินเวลาเก็บเครื่องฟรีแล้ว ร้านไม่คิดค่าฝากเก็บ แค่โทรเตือน", "Free storage is over. There is no storage fee; just give them a call.")}</p>
                    <div className="table-wrap">
                        <table className="table">
                            <thead><tr><th>{L("ใบงาน", "Ticket")}</th><th>{L("ลูกค้า", "Customer")}</th><th>{L("โทร", "Phone")}</th><th>{L("ครบกำหนดเก็บฟรี", "Free until")}</th><th className="right">{L("เกินมา", "Overdue")}</th></tr></thead>
                            <tbody>
                                {d.overdue_pickups.map((w) => (
                                    <tr key={w.work_order_id}>
                                        <td><Link to={`/admin/work-orders/${w.work_order_id}`} className="num">{w.work_order_number}</Link></td>
                                        <td>{w.customer_name || "—"}</td>
                                        <td className="num">{w.customer_phone ? <a href={`tel:${w.customer_phone}`}>{w.customer_phone}</a> : "—"}</td>
                                        <td>{fmt.date(w.pickup.free_until)}</td>
                                        <td className="right num">{L(`${w.pickup.days_overdue} วัน`, `${w.pickup.days_overdue} d`)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <section className="stack">
                <div className="panel-head" style={{ marginBottom: 0 }}>
                    <h2>{L("คำขอที่รอนำเครื่องมา", "Requests waiting for the device")}</h2>
                    <Link to="/admin/bookings">{L("ดูคำขอทั้งหมด", "All requests")}</Link>
                </div>
                <div className="table-wrap">
                    <table className="table">
                        <thead><tr><th>{L("แจ้งเมื่อ", "Sent")}</th><th>{L("เลขคำขอ", "Request")}</th><th>{L("ลูกค้า", "Customer")}</th><th>{L("เครื่องและอาการ", "Device and fault")}</th></tr></thead>
                        <tbody>
                            {d.upcoming.length === 0 && <tr><td colSpan={4} className="muted">{L("ไม่มีคำขอที่รออยู่", "No requests waiting")}</td></tr>}
                            {d.upcoming.map((b) => (
                                <tr key={b.booking_id}>
                                    <td className="num">{fmt.dateTime(b.created_at)}</td>
                                    <td className="num">{b.booking_number}</td>
                                    <td>
                                        {b.customer_name}
                                        {b.contact_phone && <div className="faint small num">{b.contact_phone}</div>}
                                    </td>
                                    <td>
                                        {deviceLine(t, b)}
                                        {b.symptom_group && <div className="faint small">{symptomLabel(t, b.symptom_group)}</div>}
                                    </td>
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
