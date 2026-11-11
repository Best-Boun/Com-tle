import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead, StatusBadge, TextField } from "../../components/ui.jsx";
import { deviceLabel } from "../../components/repair.jsx";
import "./admin.css";

export default function AdminWorkOrders() {
    const { L, t, fmt } = useI18n();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const status = params.get("status") ?? "OPEN";
    const search = params.get("q") || "";
    const list = useAsync(() => api.repairs.listAll({ status, search }), [status, search]);

    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        next.set(key, value);
        setParams(next, { replace: true });
    };

    return (
        <div>
            <PageHead
                title={L("ใบงานซ่อม", "Work orders")}
                actions={<Link to="/admin/work-orders/new" className="btn btn-primary">{L("รับเครื่อง Walk-in", "New walk-in")}</Link>}
            />
            <div className="filters">
                <TextField as="select" label={L("แสดง", "Show")} value={status} onChange={(e) => setFilter("status", e.target.value)}>
                    <option value="OPEN">{L("งานที่เปิดอยู่", "Open jobs")}</option>
                    <option value="READY">{L("ซ่อมเสร็จ รอส่งมอบ", "Ready for handover")}</option>
                    <option value="">{t("common.all")}</option>
                    {["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "REPAIRING", "TESTING", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{t(`status.wo.${s}`)}</option>)}
                </TextField>
                <TextField type="search" label={t("common.search")} placeholder={L("เลขใบงาน ชื่อ เบอร์โทร รุ่น", "Number, name, phone, model")} value={search} onChange={(e) => setFilter("q", e.target.value)} />
            </div>
            {list.loading && !list.data && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data && (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{L("ใบงาน", "Ticket")}</th>
                                <th>{L("ลูกค้า", "Customer")}</th>
                                <th>{L("เครื่อง", "Device")}</th>
                                <th>{L("ช่าง", "Technician")}</th>
                                <th>{L("สถานะ", "Status")}</th>
                                <th className="right">{L("ค้างชำระ", "Balance")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.data.length === 0 && <tr><td colSpan={6} className="muted">{L("ไม่มีใบงานตามตัวกรองนี้", "No work orders match.")}</td></tr>}
                            {list.data.map((w) => (
                                <tr key={w.work_order_id} className="clickable" onClick={() => navigate(`/admin/work-orders/${w.work_order_id}`)}>
                                    <td className="num">
                                        <Link to={`/admin/work-orders/${w.work_order_id}`} onClick={(e) => e.stopPropagation()}>{w.work_order_number}</Link>
                                        <div className="faint small">{t(`source.${w.source}`)} · {fmt.date(w.created_at)}</div>
                                    </td>
                                    <td>{w.customer_name}<div className="faint small">{w.customer_phone}</div></td>
                                    <td>{deviceLabel(w)}<div className="faint small">{w.reported_symptom}</div></td>
                                    <td>{w.technician_name || <span className="badge tone-amber">{L("ยังไม่มอบหมาย", "Unassigned")}</span>}</td>
                                    <td>
                                        <StatusBadge kind="wo" status={w.handed_over_at ? "HANDED_OVER" : w.status} />
                                        {w.has_pending_quotation && <div className="faint small">{L("มีใบเสนอราคารอดำเนินการ", "Quotation in progress")}</div>}
                                    </td>
                                    <td className="right">{w.payment.due > 0 ? <Money value={w.payment.balance} /> : <span className="faint">—</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
