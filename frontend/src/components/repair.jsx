import { useI18n } from "../i18n/I18nProvider.jsx";
import { WO_STAGES } from "../i18n/dictionary.js";
import { Money, StatusBadge } from "./ui.jsx";
import "../pages/customer/customer.css";

/** Stage bar for a work order (customer-friendly). */
export function RepairProgress({ status, handedOver }) {
    const { t } = useI18n();
    if (status === "CANCELLED") return null;
    const index = WO_STAGES.indexOf(status);
    return (
        <ol className="steps" style={{ "--count": WO_STAGES.length + 1 }} aria-label="progress">
            {WO_STAGES.map((s, i) => (
                <li key={s} className={i < index || (handedOver && i === index) ? "done" : i === index ? "current" : ""}>
                    <span>{t(`status.wo.${s}`)}</span>
                </li>
            ))}
            <li className={handedOver ? "done current" : ""}><span>{t("status.wo.HANDED_OVER")}</span></li>
        </ol>
    );
}

/** One quotation revision, rendered like a printed document. Revisions are never overwritten. */
export function QuotationCard({ quotation, superseded = false, children }) {
    const { L, t, fmt } = useI18n();
    const q = quotation;
    return (
        <article className={`quote ${q.status === "SENT" ? "is-sent" : ""} ${superseded ? "is-superseded" : ""}`}>
            <header className="quote-head">
                <div className="cluster" style={{ gap: 8 }}>
                    <strong>{t(`quote.kind.${q.kind}`)} Rev.{q.revision}</strong>
                    <StatusBadge kind="quote" status={q.status} />
                </div>
                <span className="small faint">{q.sent_at ? `${L("ส่งเมื่อ", "Sent")} ${fmt.dateTime(q.sent_at)}` : L("ยังไม่ส่งให้ลูกค้า", "Not sent yet")}</span>
            </header>
            <div className="quote-body">
                {q.note && <p className="small">{q.note}</p>}
                <div className="table-wrap" style={{ border: 0 }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{L("รายการ", "Item")}</th>
                                <th className="right">{L("จำนวน", "Qty")}</th>
                                <th className="right">{L("ราคา/หน่วย", "Unit")}</th>
                                <th className="right">{L("รวม", "Total")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {q.items.map((i) => (
                                <tr key={i.item_id}>
                                    <td>
                                        {i.description}
                                        <span className="faint small"> · {t(`item.${i.type}`)}</span>
                                    </td>
                                    <td className="right num">{i.qty}</td>
                                    <td className="right">{q.status === "DRAFT" && !i.unit_price ? "—" : <Money value={i.unit_price} />}</td>
                                    <td className="right">{q.status === "DRAFT" && !i.unit_price ? "—" : <Money value={i.qty * i.unit_price} />}</td>
                                </tr>
                            ))}
                            <tr className="quote-total">
                                <td colSpan={3}>{L("ยอดรวม", "Total")}</td>
                                <td className="right">{q.status === "DRAFT" && !q.total ? "—" : <Money value={q.total} />}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                {q.decided_at && (
                    <p className="small muted">
                        {q.status === "APPROVED" ? L("อนุมัติโดย", "Approved by") : L("ปฏิเสธโดย", "Rejected by")} {q.decided_by_name || "—"} · {fmt.dateTime(q.decided_at)}
                        {q.decision_note && <> · “{q.decision_note}”</>}
                    </p>
                )}
                {children}
            </div>
        </article>
    );
}

/** Balance is computed by the Payment Service from recorded transactions. */
export function PaymentSummary({ payment }) {
    const { L } = useI18n();
    return (
        <div className="pay-sum">
            <div><span className="muted">{L("ยอดตามใบเสนอราคาที่อนุมัติ", "Approved total")}</span><Money value={payment.due} /></div>
            <div><span className="muted">{L("ชำระแล้ว", "Paid")}</span><Money value={payment.paid} /></div>
            {payment.refunded > 0 && <div><span className="muted">{L("คืนเงินแล้ว", "Refunded")}</span><span>−<Money value={payment.refunded} /></span></div>}
            <div className="balance"><span>{L("ค้างชำระ", "Balance")}</span><Money value={payment.balance} /></div>
            {(payment.due > 0 || payment.paid > 0) && <div><span /><StatusBadge kind="pay" status={payment.status} /></div>}
        </div>
    );
}

export function WoHistory({ history }) {
    const { L, t, fmt } = useI18n();
    return (
        <ol className="timeline">
            {history.map((h) => (
                <li key={h.id}>
                    <strong>{h.old_status === h.new_status ? (h.note || "—") : t(`status.wo.${h.new_status}`)}</strong>
                    <div className="faint small">
                        {fmt.dateTime(h.created_at)} · {h.changed_by_name || L("ระบบ", "System")}
                        {h.old_status !== h.new_status && h.note ? ` · ${h.note}` : ""}
                    </div>
                </li>
            ))}
        </ol>
    );
}

export function deviceLabel(x) {
    return [x.brand, x.model].filter(Boolean).join(" ") || x.device_type;
}
