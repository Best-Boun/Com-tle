import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { api } from "../api/index.js";
import { Modal, Money, StatusBadge, TextField, useAction } from "./ui.jsx";

/** Refund requests that still need someone to act on them. */
export const OPEN_REFUND = ["REQUESTED", "APPROVED"];

/**
 * Two-person refunds, as Payment-Service enforces them:
 * one admin requests, ANOTHER admin approves and then confirms the money went back.
 * Anyone with refund rights (including the requester) may reject an open request.
 */
export default function RefundRequests({ refunds, onChanged, showWorkOrder = false }) {
    const { L, t, fmt } = useI18n();
    const { user } = useAuth();
    const [run, busy] = useAction();
    const [modal, setModal] = useState(null); // { type: "reject" | "execute", refund }
    const [reason, setReason] = useState("");

    async function act(fn, message) {
        const done = await run(fn, message).catch(() => null);
        if (done) {
            setModal(null);
            setReason("");
            onChanged?.();
        }
    }

    const mine = (r) => r.requested_by === user?.user_id;

    function actions(r) {
        if (!OPEN_REFUND.includes(r.status)) return null;
        if (mine(r)) {
            return (
                <div className="refund-mine">
                    <span className="faint small">
                        {r.status === "REQUESTED"
                            ? L("รอผู้ดูแลคนอื่นอนุมัติ", "Waiting for another admin to approve")
                            : L("รอผู้ดูแลคนอื่นยืนยันการโอนคืน", "Waiting for another admin to pay it out")}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setModal({ type: "reject", refund: r })}>{L("ยกเลิกคำขอ", "Withdraw")}</button>
                </div>
            );
        }
        return (
            <div className="btn-row">
                {r.status === "REQUESTED" ? (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => api.payments.approveRefund(r.refund_id), L("อนุมัติคำขอคืนเงินแล้ว", "Refund approved"))}>{L("อนุมัติ", "Approve")}</button>
                ) : (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setModal({ type: "execute", refund: r })}>{L("ยืนยันโอนคืนแล้ว", "Mark as paid out")}</button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setModal({ type: "reject", refund: r })}>{L("ปฏิเสธ", "Reject")}</button>
            </div>
        );
    }

    function who(r) {
        const parts = [`${L("ขอโดย", "Requested by")} ${r.requested_by_name || "—"}`];
        if (r.approved_by_name) parts.push(`${L("อนุมัติโดย", "approved by")} ${r.approved_by_name}`);
        return parts.join(" · ");
    }

    const closing = modal?.refund;
    const withdrawing = modal?.type === "reject" && closing && mine(closing);

    return (
        <>
            <ul className="refund-list">
                {refunds.map((r) => (
                    <li key={r.refund_id} className="refund-item">
                        <div className="refund-main">
                            <div className="refund-head">
                                <strong><Money value={r.amount} /></strong>
                                <StatusBadge kind="refund" status={r.status} />
                                {showWorkOrder && r.work_order_number && (
                                    <Link to={`/admin/work-orders/${r.work_order_id}`} className="num small">{r.work_order_number}</Link>
                                )}
                                {showWorkOrder && r.customer_name && <span className="small muted">{r.customer_name}</span>}
                            </div>
                            <div className="small">{r.reason}</div>
                            <div className="faint small">{fmt.dateTime(r.requested_at)} · {who(r)}</div>
                            {r.status === "REJECTED" && r.rejection_reason && (
                                <div className="faint small">{L("เหตุผลที่ปฏิเสธ", "Rejected because")}: {r.rejection_reason}</div>
                            )}
                        </div>
                        <div className="refund-actions">{actions(r)}</div>
                    </li>
                ))}
            </ul>

            {modal?.type === "execute" && (
                <Modal title={L("ยืนยันการโอนเงินคืน", "Confirm the payout")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act(() => api.payments.executeRefund(closing.refund_id), L("คืนเงินเรียบร้อย ยอดในใบงานอัปเดตแล้ว", "Refund completed — the balance is updated"))}>
                            {L("โอนคืนแล้ว", "Paid out")} <Money value={closing.amount} />
                        </button>
                    </>
                )}>
                    <div className="stack">
                        <p>{L("กดยืนยันหลังจากโอนเงินคืนลูกค้าแล้วจริงเท่านั้น ระบบจะบันทึกเป็นรายการคืนเงินและแก้ยอดในใบงาน ย้อนกลับไม่ได้", "Confirm only after the money has actually gone back to the customer. This records the refund and updates the balance, and cannot be undone.")}</p>
                        <dl className="facts">
                            <dt>{L("จำนวน", "Amount")}</dt><dd><Money value={closing.amount} /></dd>
                            {closing.work_order_number && (<><dt>{L("ใบงาน", "Ticket")}</dt><dd className="num">{closing.work_order_number}</dd></>)}
                            <dt>{L("เหตุผล", "Reason")}</dt><dd>{closing.reason}</dd>
                            <dt>{L("ขอโดย", "Requested by")}</dt><dd>{closing.requested_by_name || "—"}</dd>
                        </dl>
                    </div>
                </Modal>
            )}

            {modal?.type === "reject" && (
                <Modal title={withdrawing ? L("ยกเลิกคำขอคืนเงิน", "Withdraw refund request") : L("ปฏิเสธคำขอคืนเงิน", "Reject refund")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => act(() => api.payments.rejectRefund(closing.refund_id, { reason }), withdrawing ? L("ยกเลิกคำขอแล้ว", "Request withdrawn") : L("ปฏิเสธคำขอแล้ว", "Refund rejected"))}>
                            {withdrawing ? L("ยกเลิกคำขอ", "Withdraw") : L("ปฏิเสธ", "Reject")}
                        </button>
                    </>
                )}>
                    <div className="stack">
                        <p className="small muted"><Money value={closing.amount} /> · {closing.reason}</p>
                        <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                </Modal>
            )}
        </>
    );
}
