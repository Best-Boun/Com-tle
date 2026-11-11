import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead, StatusBadge } from "../../components/ui.jsx";
import "./admin.css";

export default function AdminPayments() {
    const { L, t, fmt } = useI18n();
    const [tab, setTab] = useState("balances");
    const data = useAsync(async () => {
        const [balances, transactions] = await Promise.all([api.payments.balances(), api.payments.listAll()]);
        return { balances, transactions };
    }, []);

    const outstanding = (data.data?.balances || []).filter((b) => b.balance > 0);
    const received = (data.data?.transactions || []).filter((p) => p.type === "PAYMENT").reduce((s, p) => s + p.amount, 0);
    const refunded = (data.data?.transactions || []).filter((p) => p.type === "REFUND").reduce((s, p) => s + p.amount, 0);

    return (
        <div>
            <PageHead title={L("การเงิน", "Payments")} lede={L("ยอดคงเหลือคำนวณจากธุรกรรมที่บันทึกไว้ รับชำระและคืนเงินได้จากหน้าใบงาน", "Balances are computed from recorded transactions. Take payments and refunds from each work order.")} />
            {data.loading && !data.data && <Loading />}
            <ErrorNotice error={data.error} onRetry={data.reload} />
            {data.data && (
                <div className="stack-lg">
                    <dl className="facts glance">
                        <dt>{L("ยอดค้างชำระรวม", "Outstanding")}</dt><dd><Money value={outstanding.reduce((s, b) => s + b.balance, 0)} /> · {outstanding.length} {L("ใบงาน", "jobs")}</dd>
                        <dt>{L("รับชำระทั้งหมด", "Received")}</dt><dd><Money value={received} /></dd>
                        <dt>{L("คืนเงินทั้งหมด", "Refunded")}</dt><dd><Money value={refunded} /></dd>
                    </dl>
                    <div className="tabs" role="tablist">
                        <button type="button" role="tab" className="tab" aria-selected={tab === "balances"} onClick={() => setTab("balances")}>{L("ยอดแต่ละใบงาน", "By work order")}</button>
                        <button type="button" role="tab" className="tab" aria-selected={tab === "tx"} onClick={() => setTab("tx")}>{L("ธุรกรรมทั้งหมด", "All transactions")}</button>
                    </div>
                    {tab === "balances" ? (
                        <div className="table-wrap">
                            <table className="table">
                                <thead><tr><th>{L("ใบงาน", "Ticket")}</th><th>{L("ลูกค้า", "Customer")}</th><th className="right">{L("ยอดอนุมัติ", "Approved")}</th><th className="right">{L("ชำระสุทธิ", "Net paid")}</th><th className="right">{L("ค้าง", "Balance")}</th><th>{L("สถานะ", "Status")}</th></tr></thead>
                                <tbody>
                                    {data.data.balances.map((b) => (
                                        <tr key={b.work_order_id}>
                                            <td className="num"><Link to={`/admin/work-orders/${b.work_order_id}`}>{b.work_order_number}</Link><div className="faint small">{t(`status.wo.${b.handed_over_at ? "HANDED_OVER" : b.status}`)}</div></td>
                                            <td>{b.customer_name}</td>
                                            <td className="right"><Money value={b.due} /></td>
                                            <td className="right"><Money value={b.net_paid} /></td>
                                            <td className="right"><strong><Money value={b.balance} /></strong></td>
                                            <td><StatusBadge kind="pay" status={b.status} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="table-wrap">
                            <table className="table">
                                <thead><tr><th>{L("เวลา", "When")}</th><th>{L("ประเภท", "Type")}</th><th>{L("ใบงาน", "Ticket")}</th><th>{L("ลูกค้า", "Customer")}</th><th className="right">{L("จำนวน", "Amount")}</th><th>{L("วิธี", "Method")}</th><th>{L("บันทึกโดย", "By")}</th></tr></thead>
                                <tbody>
                                    {data.data.transactions.map((p) => (
                                        <tr key={p.payment_id}>
                                            <td className="num">{fmt.dateTime(p.created_at)}</td>
                                            <td><span className={`badge tone-${p.type === "PAYMENT" ? "green" : "blue"}`}>{t(`pay.type.${p.type}`)}</span></td>
                                            <td className="num"><Link to={`/admin/work-orders/${p.work_order_id}`}>{p.work_order_number}</Link></td>
                                            <td>{p.customer_name}</td>
                                            <td className="right">{p.type === "REFUND" ? "−" : ""}<Money value={p.amount} /></td>
                                            <td>{t(`pay.method.${p.method}`)}</td>
                                            <td>{p.recorded_by_name}{p.note && <div className="faint small">{p.note}</div>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
