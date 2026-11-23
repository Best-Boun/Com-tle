import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { deviceTypeText, itemText, noteText, optionText } from "../utils/serverText.js";
import { WO_STAGES } from "../i18n/dictionary.js";
import { Money, StatusBadge, TextField } from "./ui.jsx";
import "../pages/customer/customer.css";

/** Stage bar for a work order (customer-friendly). */
export function RepairProgress({ status, handedOver, declined = false }) {
    const { t, lang } = useI18n();
    if (status === "CANCELLED") return null;
    // "No repair" skips the repair stages: inspected, then straight to pick-up.
    const stages = declined ? WO_STAGES.filter((s) => !["APPROVED", "REPAIRING", "TESTING"].includes(s)) : WO_STAGES;
    // Waiting for parts sits between "approved" and "repairing".
    const index = stages.indexOf(status === "WAITING_PARTS" ? "APPROVED" : status);
    return (
        <ol className="steps" style={{ "--count": stages.length + 2 }} aria-label="progress">
            <li className="done"><span>{t("status.wo.RECEIVED")}</span></li>
            {stages.map((s, i) => (
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
    const { L, t, fmt, lang } = useI18n();
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
                {q.options?.length > 0 ? (
                    <OptionList quotation={q} />
                ) : (
                    <ItemsTable items={q.items} total={q.total} draft={q.status === "DRAFT"} />
                )}
                {q.decided_at && (
                    <p className="small muted">
                        {q.selected_option_id ? L("เลือกโดย", "Chosen by") : q.status === "APPROVED" ? L("อนุมัติโดย", "Approved by") : L("ปฏิเสธโดย", "Rejected by")} {q.decided_by_name || "—"} · {fmt.dateTime(q.decided_at)}
                        {q.decision_note && <> · “{q.decision_note}”</>}
                    </p>
                )}
                {children}
            </div>
        </article>
    );
}

function ItemsTable({ items, total, draft = false }) {
    const { L, t, lang } = useI18n();
    return (
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
                    {items.map((i) => (
                        <tr key={i.item_id}>
                            <td>
                                {itemText(i.description, lang)}
                                <span className="faint small"> · {t(`item.${i.type}`)}</span>
                            </td>
                            <td className="right num">{i.qty}</td>
                            <td className="right">{draft && !i.unit_price ? "—" : <Money value={i.unit_price} />}</td>
                            <td className="right">{draft && !i.unit_price ? "—" : <Money value={i.qty * i.unit_price} />}</td>
                        </tr>
                    ))}
                    <tr className="quote-total">
                        <td colSpan={3}>{L("ยอดรวม", "Total")}</td>
                        <td className="right">{draft && !total ? "—" : <Money value={total} />}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

/** Title of an option: the system's own options are labelled in the reader's language. */
export function optionTitle(option, t, lang) {
    if (option.kind === "REPAIR" || lang === "th") return option.title;
    return t(`option.kind.${option.kind}`);
}

function OptionBody({ option }) {
    const { L, t, lang } = useI18n();
    return (
        <>
            {option.description && <p className="small muted" style={{ margin: 0 }}>{optionText(option, lang).description}</p>}
            {option.items.length > 0 && option.kind === "REPAIR" && (
                <ul className="small">
                    {option.items.map((i) => (
                        <li key={i.item_id}>
                            {i.description} <span className="faint">· {t(`item.${i.type}`)}{i.qty > 1 ? ` ×${i.qty}` : ""}</span> — <Money value={i.qty * i.unit_price} />
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

/** All options of a quotation, read-only. The chosen one is marked once decided. */
export function OptionList({ quotation }) {
    const { L, t, lang } = useI18n();
    const decided = Boolean(quotation.selected_option_id);
    return (
        <ol className="quote-options">
            {quotation.options.map((o, index) => {
                const chosen = o.option_id === quotation.selected_option_id;
                return (
                    <li key={o.option_id} className={`quote-option ${o.kind !== "REPAIR" ? "is-system" : ""} ${chosen ? "is-chosen" : ""} ${decided && !chosen ? "is-faded" : ""}`}>
                        <div className="quote-option-head">
                            <span><span className="faint">{index + 1}.</span> <strong>{optionTitle(o, t, lang)}</strong>{chosen && <span className="small"> · {L("ตัวเลือกที่เลือก", "Chosen")}</span>}</span>
                            <strong><Money value={o.total} /></strong>
                        </div>
                        <OptionBody option={o} />
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * Pick one option and confirm. Used by customers on their tracking page and by
 * the shop for walk-in customers (who have no account).
 */
export function OptionPicker({ quotation, busy, onChoose, confirmLabel, noteLabel }) {
    const { L, t, lang } = useI18n();
    const [picked, setPicked] = useState(null);
    const [note, setNote] = useState("");
    const choice = quotation.options.find((o) => o.option_id === picked);
    return (
        <div className="stack">
            <ol className="quote-options">
                {quotation.options.map((o, index) => (
                    <li key={o.option_id} className={`quote-option ${o.kind !== "REPAIR" ? "is-system" : ""} ${picked === o.option_id ? "is-picked" : ""}`}>
                        <div className="quote-option-head">
                            <label>
                                <input type="radio" name={`option-${quotation.quotation_id}`} checked={picked === o.option_id} onChange={() => setPicked(o.option_id)} />
                                <span><span className="faint">{index + 1}.</span> {optionTitle(o, t, lang)}</span>
                            </label>
                            <strong><Money value={o.total} /></strong>
                        </div>
                        <OptionBody option={o} />
                    </li>
                ))}
            </ol>
            {noteLabel && <TextField as="textarea" label={noteLabel} value={note} onChange={(e) => setNote(e.target.value)} />}
            <div>
                <button type="button" className="btn btn-primary" disabled={busy || !choice} onClick={() => onChoose(choice, note)}>
                    {choice
                        ? <>{confirmLabel || L("ยืนยันตัวเลือกนี้", "Confirm this option")} · <Money value={choice.total} /></>
                        : L("เลือก 1 ตัวเลือก", "Pick one option")}
                </button>
            </div>
        </div>
    );
}

/** How long a ready device is kept for free, and whether that time is up. */
export function PickupNote({ workOrder }) {
    const { L, fmt, lang } = useI18n();
    const p = workOrder.pickup;
    if (!p || workOrder.handed_over_at) return null;
    return p.overdue ? (
        <div className="notice warn small">
            {L(`เกินเวลาเก็บเครื่องฟรี ${p.days_overdue} วัน (ครบกำหนด ${fmt.date(p.free_until)}) โทรตามลูกค้าให้มารับเครื่อง`, `Free storage ended ${p.days_overdue} day(s) ago (${fmt.date(p.free_until)}). Call the customer to collect it.`)}
        </div>
    ) : (
        <p className="small muted">
            {L(`เก็บเครื่องให้ฟรี ${p.free_days} วัน ถึง ${fmt.date(p.free_until)}`, `Kept free for ${p.free_days} days, until ${fmt.date(p.free_until)}`)}
        </p>
    );
}

/** Balance is computed by the Payment Service from recorded transactions. */
export function PaymentSummary({ payment }) {
    const { L, lang } = useI18n();
    if (payment.unavailable) {
        return (
            <div className="notice warn small" role="status">
                {L("ระบบการเงินไม่พร้อมใช้งานชั่วคราว ยอดชำระจะแสดงเมื่อระบบกลับมา ส่วนอื่นของใบงานใช้งานได้ตามปกติ", "The payment system is temporarily unavailable. Balances will show again once it is back; the rest of this ticket works as usual.")}
            </div>
        );
    }
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
    const { L, t, fmt, lang } = useI18n();
    return (
        <ol className="timeline">
            {history.map((h, index) => {
                // An event that did not change the status (a choice on extra work,
                // an assignment): old_status equals new_status, or is null after
                // the first row. Show its note instead of the status.
                const isEvent = h.old_status === h.new_status || (index > 0 && !h.old_status && Boolean(h.note));
                return (
                    <li key={h.id}>
                        <strong>{isEvent ? (noteText(h.note, lang) || "—") : t(`status.wo.${h.new_status}`)}</strong>
                        <div className="faint small">
                            {fmt.dateTime(h.created_at)} · {h.changed_by_name || L("ระบบ", "System")}
                            {!isEvent && h.note ? ` · ${noteText(h.note, lang)}` : ""}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

/** Brand and model, or the device type in the reader's language when there is neither. */
export function deviceLabel(x, lang = "th") {
    return [x.brand, x.model].filter(Boolean).join(" ") || deviceTypeText(x.device_type, lang);
}

/** "Notebook · Asus · VivoBook" in the reader's language. */
export function deviceFacts(x, lang = "th") {
    return [deviceTypeText(x.device_type, lang), x.brand, x.model].filter(Boolean).join(" · ");
}
