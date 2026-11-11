import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, Money, PageHead, StatusBadge } from "../../components/ui.jsx";

export default function MyPayments() {
    const { L, t, fmt } = useI18n();
    const list = useAsync(() => api.payments.listMine(), []);
    const totalDue = (list.data || []).reduce((s, r) => s + r.summary.balance, 0);

    return (
        <div>
            <PageHead title={L("การชำระเงิน", "Payments")} lede={L("ยอดค้างคิดจากใบเสนอราคาที่คุณอนุมัติ ลบด้วยยอดที่ชำระแล้ว", "Balances come from quotations you approved minus what you've paid.")} />
            {list.loading && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data?.length === 0 && <Empty title={L("ยังไม่มีรายการชำระเงิน", "No payments yet")} />}
            {list.data?.length > 0 && (
                <div className="stack-lg">
                    <div className="stats" style={{ maxWidth: 420 }}>
                        <div className="stat">
                            <div className="stat-value"><Money value={totalDue} /></div>
                            <div className="stat-label">{L("ยอดค้างชำระทั้งหมด", "Total outstanding")}</div>
                        </div>
                    </div>
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{L("ใบงาน", "Ticket")}</th>
                                    <th>{L("เครื่อง / บริการ", "Device / service")}</th>
                                    <th className="right">{L("ยอดอนุมัติ", "Approved")}</th>
                                    <th className="right">{L("ชำระแล้ว", "Paid")}</th>
                                    <th className="right">{L("ค้าง", "Balance")}</th>
                                    <th>{L("สถานะ", "Status")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.data.map((r) => (
                                    <tr key={r.work_order_id}>
                                        <td className="num"><Link to={`/my/repairs/${r.work_order_id}`}>{r.work_order_number}</Link></td>
                                        <td>{r.device}<div className="faint small">{r.service_name}</div></td>
                                        <td className="right"><Money value={r.summary.due} /></td>
                                        <td className="right"><Money value={r.summary.net_paid} /></td>
                                        <td className="right"><strong><Money value={r.summary.balance} /></strong></td>
                                        <td><StatusBadge kind="pay" status={r.summary.status} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <section className="stack">
                        <h2>{L("ประวัติธุรกรรม", "Transactions")}</h2>
                        <ul className="timeline">
                            {list.data.flatMap((r) => r.transactions.map((p) => ({ ...p, number: r.work_order_number })))
                                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                                .map((p) => (
                                    <li key={p.payment_id}>
                                        <strong>{t(`pay.type.${p.type}`)} <Money value={p.amount} /></strong>
                                        <div className="faint small">{fmt.dateTime(p.created_at)} · {p.number}{p.type === "PAYMENT" ? ` · ${t(`pay.method.${p.method}`)}` : ""}{p.note ? ` · ${p.note}` : ""}</div>
                                    </li>
                                ))}
                        </ul>
                    </section>
                </div>
            )}
        </div>
    );
}
