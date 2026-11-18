import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, Stamp, TextField, useAction } from "../../components/ui.jsx";
import { OptionPicker, PaymentSummary, PickupNote, QuotationCard, RepairProgress, WoHistory, deviceLabel } from "../../components/repair.jsx";
import RefundRequests, { OPEN_REFUND } from "../../components/RefundRequests.jsx";
import "./admin.css";

const OPEN = ["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "WAITING_PARTS", "REPAIRING", "TESTING"];
const PAYMENT_POLL_MS = 8000;

export default function AdminWorkOrderDetail() {
    const { workOrderId } = useParams();
    const { L, t, fmt } = useI18n();
    const wo = useAsync(() => api.repairs.get(workOrderId), [workOrderId]);
    const techs = useAsync(() => api.auth.listTechnicians(), []);
    const parts = useAsync(() => api.inventory.listParts(), []);
    const refunds = useAsync(() => api.payments.listRefunds({ work_order_id: workOrderId }), [workOrderId]);
    const [run, busy] = useAction();
    const [modal, setModal] = useState(null); // "pay" | "refund" | "handover" | "cancel"
    const [form, setForm] = useState({});

    async function act(fn, message) {
        const updated = await run(fn, message).catch(() => null);
        if (updated) {
            wo.setData(updated);
            setModal(null);
            setForm({});
            parts.reload();
            refunds.reload();
        }
        return updated;
    }

    // Approving or paying out a refund changes the balance shown in the payment box.
    function refundsChanged() {
        refunds.reload();
        wo.reload();
    }

    // Customers can pay online, so while money is still due keep the payment
    // box fresh. Only payment fields are replaced: forms on the page stay as typed.
    const latest = useRef(wo.data);
    latest.current = wo.data;
    const paymentDown = Boolean(wo.data?.payment.unavailable);
    const awaitingPayment = Boolean(wo.data && (wo.data.payment.balance > 0 || paymentDown) && wo.data.status !== "CANCELLED");
    useEffect(() => {
        if (!awaitingPayment || modal) return undefined;
        const timer = setInterval(async () => {
            if (document.hidden) return;
            const fresh = await api.repairs.get(workOrderId).catch(() => null);
            const current = latest.current;
            if (!fresh || !current) return;
            const recovered = Boolean(current.payment.unavailable) !== Boolean(fresh.payment.unavailable);
            if (!recovered && fresh.payment.paid === current.payment.paid) return;
            wo.setData({ ...current, payment: fresh.payment, payments: fresh.payments });
            if (recovered) refunds.reload();
        }, PAYMENT_POLL_MS);
        return () => clearInterval(timer);
    }, [awaitingPayment, modal, workOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (wo.loading && !wo.data) return <Loading />;
    if (wo.error) return <ErrorNotice error={wo.error} onRetry={wo.reload} />;
    const w = wo.data;
    const isOpen = OPEN.includes(w.status);
    const sent = w.quotations.filter((q) => q.status === "SENT");
    const issuable = ["APPROVED", "WAITING_PARTS", "REPAIRING", "TESTING"].includes(w.status) ? w.parts.filter((p) => p.remaining_qty > 0) : [];
    // A device the customer chose not to repair goes back without a test.
    const canHandover = w.status === "COMPLETED" && (w.test_result?.passed || w.repair_declined) && !w.handed_over_at;
    const refundList = refunds.data || [];
    const reserved = refundList.filter((r) => OPEN_REFUND.includes(r.status)).reduce((s, r) => s + r.amount, 0);
    const refundable = Math.max(0, w.payment.net_paid - reserved);

    return (
        <div className="stack-lg">
            <Link to="/admin/work-orders" className="small">← {L("ใบงานซ่อม", "Work orders")}</Link>

            <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                    <p className="faint small">{t(`source.${w.source}`)}{w.booking_number ? ` · ${w.booking_number}` : ""} · {L("เปิดเมื่อ", "opened")} {fmt.dateTime(w.created_at)}</p>
                    <h1 className="num">{w.work_order_number}</h1>
                    <p>{w.customer_name} · {deviceLabel(w)}</p>
                </div>
                <Stamp kind="wo" status={w.handed_over_at ? "HANDED_OVER" : w.status} />
            </div>

            <RepairProgress status={w.status} handedOver={Boolean(w.handed_over_at)} declined={w.repair_declined} />

            <div className="split">
                <div className="stack-lg">
                    {sent.map((q) => (
                        <section key={q.quotation_id} className={`action-panel ${w.source === "WALK_IN" ? "" : "calm"}`}>
                            <h2>{L(`รอลูกค้าเลือก ${t(`quote.kind.${q.kind}`)} Rev.${q.revision}`, `Waiting on ${t(`quote.kind.${q.kind}`)} Rev.${q.revision}`)}</h2>
                            {w.source === "WALK_IN" && q.options?.length > 0 ? (
                                <>
                                    <p className="muted small">{L("ลูกค้า walk-in ไม่มีบัญชี บันทึกตัวเลือกที่ลูกค้าเลือกที่หน้าร้านหรือทางโทรศัพท์", "Walk-in customers have no account. Record the option they chose in person or by phone.")}</p>
                                    <OptionPicker
                                        quotation={q}
                                        busy={busy}
                                        confirmLabel={L("บันทึกว่าลูกค้าเลือกตัวเลือกนี้", "Record the customer's choice")}
                                        noteLabel={L("รายละเอียด (เช่น ช่องทางที่ลูกค้าตอบ)", "Details (e.g. how the customer answered)")}
                                        onChoose={(option, note) => act(
                                            () => api.repairs.decideQuotation(q.quotation_id, { option_id: option.option_id, note: note.trim() || L("ลูกค้า walk-in ตอบที่หน้าร้าน", "Walk-in customer answered in person") }),
                                            L("บันทึกตัวเลือกแล้ว", "Choice recorded")
                                        )}
                                    />
                                </>
                            ) : (
                                <>
                                    <p className="muted small">{L("ลูกค้าที่มีบัญชีเลือกเองในหน้าติดตามงานซ่อม และได้รับอีเมลแจ้งแล้ว", "Customers with an account choose from their tracking page.")}</p>
                                    <QuotationCard quotation={q} />
                                </>
                            )}
                        </section>
                    ))}

                    {issuable.length > 0 && (
                        <section className="action-panel">
                            <h2>{L("เบิกอะไหล่ตามที่อนุมัติ", "Issue approved parts")}</h2>
                            <p className="muted small">{L("Inventory เป็นผู้ตัดสต็อก เบิกได้ไม่เกินจำนวนที่ลูกค้าอนุมัติ", "Inventory deducts the stock. You can't issue more than was approved.")}</p>
                            <div className="table-wrap">
                                <table className="table">
                                    <thead><tr><th>{L("อะไหล่", "Part")}</th><th className="right">{L("อนุมัติ", "Approved")}</th><th className="right">{L("เบิกแล้ว", "Issued")}</th><th className="right">{L("ในสต็อก", "In stock")}</th><th /></tr></thead>
                                    <tbody>
                                        {issuable.map((p) => (
                                            <tr key={p.part_id}>
                                                <td>{p.name}</td>
                                                <td className="right num">{p.approved_qty}</td>
                                                <td className="right num">{p.issued_qty}</td>
                                                <td className="right num">{p.stock}</td>
                                                <td className="right">
                                                    <button type="button" className="btn btn-primary btn-sm" disabled={busy || p.stock < 1} onClick={() => act(() => api.inventory.issueForWorkOrder(w.work_order_id, { partId: p.part_id, qty: Math.min(p.remaining_qty, p.stock) }), L("เบิกอะไหล่แล้ว", "Parts issued"))}>
                                                        {p.stock < 1 ? L("ของหมด", "Out of stock") : L(`เบิก ${Math.min(p.remaining_qty, p.stock)}`, `Issue ${Math.min(p.remaining_qty, p.stock)}`)}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {canHandover && (
                        <section className="action-panel">
                            <h2>{L("ส่งมอบเครื่องให้ลูกค้า", "Hand the device back")}</h2>
                            {paymentDown ? (
                                <div className="notice warn">{L("ตรวจยอดชำระไม่ได้เพราะระบบการเงินไม่พร้อม ส่งมอบได้เมื่อระบบกลับมา (หน้านี้จะอัปเดตเอง)", "Payments can't be checked while the payment system is down. Hand over once it is back (this page updates by itself).")}</div>
                            ) : (<>
                            <PickupNote workOrder={w} />
                            {w.repair_declined && <p className="small">{L("ลูกค้าเลือกไม่ซ่อม เก็บค่าตรวจเช็กแล้วคืนเครื่อง", "The customer chose not to repair: take the inspection fee and return the device.")}</p>}
                            {w.payment.balance > 0
                                ? <div className="notice warn">{L(`ยังค้างชำระ ${fmt.money(w.payment.balance)} ต้องรับชำระให้ครบ หรือให้ Admin อนุมัติข้อยกเว้นพร้อมเหตุผล`, `${fmt.money(w.payment.balance)} still due. Take payment first, or approve an exception with a reason.`)}</div>
                                : <p className="muted small">{w.repair_declined ? L("ชำระครบแล้ว", "Fully paid.") : L("ซ่อมเสร็จ ทดสอบผ่าน และชำระครบแล้ว", "Repaired, tested and fully paid.")}</p>}
                            <div className="btn-row">
                                {w.payment.balance > 0 && <button type="button" className="btn btn-primary" onClick={() => { setForm({ amount: String(w.payment.balance), method: "CASH" }); setModal("pay"); }}>{L("รับชำระเงิน", "Take payment")}</button>}
                                <button type="button" className={`btn ${w.payment.balance > 0 ? "btn-secondary" : "btn-primary"}`} onClick={() => { setForm({ reason: "", termsAcknowledged: false }); setModal("handover"); }}>
                                    {w.payment.balance > 0 ? L("ส่งมอบแบบข้อยกเว้น", "Hand over with exception") : L("ส่งมอบเครื่องแล้ว", "Mark as handed over")}
                                </button>
                            </div>
                            </>)}
                        </section>
                    )}

                    {w.handed_over_at && (
                        <div className="notice ok">
                            {L("ส่งมอบเมื่อ", "Handed over")} {fmt.dateTime(w.handed_over_at)}
                            {w.handover_exception && ` · ${L("ข้อยกเว้น", "Exception")}: ${w.handover_exception.reason} (${L("ค้าง", "due")} ${fmt.money(w.handover_exception.outstanding)}, ${L("อนุมัติโดย", "approved by")} ${w.handover_exception.approved_by_name})`}
                        </div>
                    )}
                    {w.status === "CANCELLED" && w.cancellation && (
                        <div className="notice error">
                            {L("ยกเลิกโดย", "Cancelled by")} {w.cancellation.by_name} · {w.cancellation.reason}
                            {w.cancellation.returned_parts.length > 0 && ` · ${L("คืนอะไหล่", "returned")}: ${w.cancellation.returned_parts.map((p) => `${p.name} ×${p.qty}`).join(", ")}`}
                        </div>
                    )}

                    <section className="stack">
                        <h2>{L("ใบเสนอราคาทุกฉบับ", "All quotations")}</h2>
                        {w.quotations.length === 0 && <p className="muted small">{L("รอช่างตรวจและเสนอรายการ", "Waiting for the technician to diagnose and propose items.")}</p>}
                        {w.quotations.map((q) => <QuotationCard key={q.quotation_id} quotation={q} superseded={q.status === "REJECTED"} />)}
                    </section>
                </div>

                <aside className="stack-lg">
                    <section className="panel stack">
                        <h3>{L("ช่างผู้รับผิดชอบ", "Technician")}</h3>
                        {isOpen ? (
                            <div className="stack">
                                <select
                                    className="select"
                                    aria-label={L("มอบหมายช่าง", "Assign technician")}
                                    value={w.technician_id || ""}
                                    disabled={busy || techs.loading || Boolean(techs.error) || techs.data?.length === 0}
                                    onChange={(e) => e.target.value && act(() => api.repairs.assignTechnician(w.work_order_id, e.target.value), L("มอบหมายช่างแล้ว", "Technician assigned"))}
                                >
                                    <option value="">
                                        {techs.loading
                                            ? L("กำลังโหลดรายชื่อช่าง...", "Loading technicians...")
                                            : techs.data?.length
                                                ? L("— เลือกช่าง —", "— Choose —")
                                                : L("ยังไม่มีช่างที่เปิดใช้งาน", "No active technicians")}
                                    </option>
                                    {techs.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                                </select>
                                {techs.error && <ErrorNotice error={techs.error} onRetry={techs.reload} />}
                                {!techs.loading && !techs.error && !techs.data?.length && (
                                    <p className="muted small">{L("เพิ่มบัญชีช่างที่เปิดใช้งานได้จากเมนูบัญชีช่าง", "Add an active technician account from Technician Accounts.")}</p>
                                )}
                            </div>
                        ) : <p>{w.technician_name || "—"}</p>}
                    </section>

                    <section className="panel stack">
                        <div className="panel-head" style={{ marginBottom: 0 }}>
                            <h3>{L("การเงิน", "Payment")}</h3>
                        </div>
                        <PaymentSummary payment={w.payment} />
                        {(w.payment.due > 0 || w.payment.paid > 0) && <div className="btn-row">
                            <button type="button" className="btn btn-secondary btn-sm" disabled={w.payment.balance <= 0 || w.status === "CANCELLED"} onClick={() => { setForm({ amount: String(w.payment.balance), method: "CASH", note: "" }); setModal("pay"); }}>{L("รับชำระ", "Take payment")}</button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={refundable <= 0} onClick={() => { setForm({ amount: "", note: "" }); setModal("refund"); }}>{L("ขอคืนเงิน", "Request refund")}</button>
                        </div>}
                        {w.payments.length > 0 && (
                            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                                {w.payments.map((p) => <li key={p.payment_id}>{fmt.dateTime(p.created_at)} · {t(`pay.type.${p.type}`)} {fmt.money(p.amount)}{p.type === "PAYMENT" ? ` · ${t(`pay.method.${p.method}`)}` : ""}{p.note ? ` · ${p.note}` : ""}</li>)}
                            </ul>
                        )}
                        {refunds.error && !paymentDown && <ErrorNotice error={refunds.error} onRetry={refunds.reload} />}
                        {refundList.length > 0 && (
                            <div className="stack">
                                <h4 className="small">{L("คำขอคืนเงิน", "Refund requests")}</h4>
                                <RefundRequests refunds={refundList} onChanged={refundsChanged} />
                            </div>
                        )}
                    </section>

                    <section className="panel">
                        <dl className="facts">
                            <dt>{L("โทร", "Phone")}</dt><dd>{w.customer_phone || "—"}</dd>
                            <dt>{L("บริการ", "Service")}</dt><dd>{w.service_name || "—"}</dd>
                            <dt>{L("เครื่อง", "Device")}</dt><dd>{[w.device_type, w.brand, w.model].filter(Boolean).join(" · ")}</dd>
                            {w.serial_number && (<><dt>Serial</dt><dd>{w.serial_number}</dd></>)}
                            <dt>{L("อาการ", "Symptom")}</dt><dd>{w.reported_symptom}</dd>
                            {w.accessories && (<><dt>{L("ของที่ฝาก", "Accessories")}</dt><dd>{w.accessories}</dd></>)}
                            {w.diagnosis && (<><dt>{L("ผลตรวจ", "Diagnosis")}</dt><dd>{w.diagnosis}</dd></>)}
                            {w.repair_result && (<><dt>{L("ผลซ่อม", "Repair")}</dt><dd>{w.repair_result}</dd></>)}
                            {w.test_result && (<><dt>{L("ทดสอบ", "Test")}</dt><dd>{w.test_result.passed ? L("ผ่าน", "Passed") : L("ไม่ผ่าน", "Failed")} · {w.test_result.notes}</dd></>)}
                        </dl>
                    </section>

                    {w.stock_movements.length > 0 && (
                        <section className="stack">
                            <h3>{L("ความเคลื่อนไหวอะไหล่", "Parts movements")}</h3>
                            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                                {w.stock_movements.map((m) => <li key={m.movement_id}>{t(`move.${m.type}`)} {m.part_name} ×{m.qty} · {fmt.dateTime(m.created_at)}</li>)}
                            </ul>
                        </section>
                    )}

                    <section className="stack">
                        <h3>{L("ประวัติ", "History")}</h3>
                        <WoHistory history={w.history} />
                    </section>

                    {isOpen && (
                        <div>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => { setForm({ reason: "", returnParts: true }); setModal("cancel"); }}>{L("ยกเลิกงานซ่อม", "Cancel this job")}</button>
                        </div>
                    )}
                </aside>
            </div>

            {modal === "pay" && (
                <Modal title={L("รับชำระเงิน", "Take payment")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-primary" disabled={busy || !form.amount} onClick={() => act(() => api.payments.record(w.work_order_id, form), L("บันทึกการชำระแล้ว", "Payment recorded"))}>{L("บันทึกการชำระ", "Record payment")}</button>
                    </>
                )}>
                    <div className="stack">
                        <p className="small muted">{L("ค้างชำระ", "Balance")} <strong><Money value={w.payment.balance} /></strong> · {L("แบ่งชำระได้", "Part payments allowed")}</p>
                        <TextField type="number" min="1" step="1" label={L("จำนวนเงิน (บาท)", "Amount (THB)")} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                        <TextField as="select" label={L("วิธีชำระ", "Method")} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                            {["CASH", "TRANSFER", "CARD"].map((m) => <option key={m} value={m}>{t(`pay.method.${m}`)}</option>)}
                        </TextField>
                        <TextField label={t("common.notes")} value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </div>
                </Modal>
            )}

            {modal === "refund" && (
                <Modal title={L("ขอคืนเงิน", "Request a refund")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-danger" disabled={busy || !form.amount || !form.note?.trim()} onClick={() => act(() => api.payments.refund(w.work_order_id, form), L("ส่งคำขอคืนเงินแล้ว รอผู้ดูแลคนอื่นอนุมัติ", "Refund requested — another admin must approve it"))}>{L("ส่งคำขอคืนเงิน", "Send request")}</button>
                    </>
                )}>
                    <div className="stack">
                        <div className="notice info small">{L("การคืนเงินต้องผ่าน 2 คน: คุณส่งคำขอ แล้วผู้ดูแลอีกคนอนุมัติและยืนยันการโอนคืน ยอดในใบงานจะเปลี่ยนเมื่อโอนคืนแล้วเท่านั้น", "Refunds take two people: you request it, then another admin approves it and confirms the payout. The balance changes only once it is paid out.")}</div>
                        <p className="small muted">{L("ขอคืนได้ไม่เกิน", "Up to")} <Money value={refundable} />{reserved > 0 ? L(` (มีคำขอค้างอยู่ ${fmt.money(reserved)})`, ` (${fmt.money(reserved)} already requested)`) : ""}</p>
                        <TextField type="number" min="1" step="1" label={L("จำนวนเงิน (บาท)", "Amount (THB)")} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                        <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </div>
                </Modal>
            )}

            {modal === "handover" && (
                <Modal title={L("ส่งมอบเครื่อง", "Hand over")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-primary" disabled={busy || !form.termsAcknowledged || (w.payment.balance > 0 && !form.reason?.trim())} onClick={() => act(() => api.repairs.handover(w.work_order_id, { exceptionReason: form.reason, terms_acknowledged: form.termsAcknowledged }), L("ส่งมอบเครื่องแล้ว", "Handed over"))}>
                            {L("ยืนยันส่งมอบ", "Confirm handover")}
                        </button>
                    </>
                )}>
                    <div className="stack">
                        {w.payment.balance > 0 ? (
                            <div className="notice warn">{L(`ลูกค้ายังค้าง ${fmt.money(w.payment.balance)} ระบบจะบันทึกผู้อนุมัติ เหตุผล และยอดค้างไว้`, `${fmt.money(w.payment.balance)} is still due. Your name, the reason and the amount will be recorded.`)}</div>
                        ) : <p>{L("ยืนยันว่าลูกค้ารับเครื่องแล้ว", "Confirm the customer has collected the device.")}</p>}
                        {w.payment.balance > 0 && <TextField as="textarea" label={L("เหตุผลที่อนุมัติข้อยกเว้น", "Reason for the exception")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={L("เช่น ลูกค้าประจำ จะโอนส่วนที่เหลือภายในศุกร์นี้", "e.g. regular customer, will transfer the rest by Friday")} />}
                        <label className="small" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <input type="checkbox" checked={form.termsAcknowledged === true} onChange={(e) => setForm({ ...form, termsAcknowledged: e.target.checked })} />
                            <span>{L("ลูกค้ารับทราบเงื่อนไขการรับเครื่อง และตรวจสอบความเรียบร้อยก่อนนำเครื่องออกจากร้าน", "The customer acknowledges the handover terms and confirms the device was checked before leaving.")}</span>
                        </label>
                    </div>
                </Modal>
            )}

            {modal === "cancel" && (
                <Modal title={L("ยกเลิกงานซ่อมนี้?", "Cancel this job?")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{L("ไม่ยกเลิก", "Keep job")}</button>
                        <button type="button" className="btn btn-danger" disabled={busy || !form.reason?.trim()} onClick={() => act(() => api.repairs.cancel(w.work_order_id, form), L("ยกเลิกงานแล้ว", "Job cancelled"))}>{L("ยกเลิกงานซ่อม", "Cancel job")}</button>
                    </>
                )}>
                    <div className="stack">
                        <p className="small muted">{L("ใบงาน ประวัติการเบิกอะไหล่ และธุรกรรมการเงินจะยังถูกเก็บไว้ทั้งหมด ถ้าต้องคืนเงินให้ทำที่ส่วนการเงินหลังยกเลิก", "The work order, parts history and payments are all kept. Refund from the payment panel afterwards if needed.")}</p>
                        <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                        <label className="checkbox"><input type="checkbox" checked={form.returnParts} onChange={(e) => setForm({ ...form, returnParts: e.target.checked })} />{L("คืนอะไหล่ที่เบิกไปแล้วเข้าสต็อก", "Return issued parts to stock")}</label>
                        {w.payment.net_paid > 0 && <div className="notice warn">{L(`ลูกค้าชำระแล้ว ${fmt.money(w.payment.net_paid)} ตรวจสอบค่าใช้จ่ายที่เกิดขึ้นก่อนคืนเงิน`, `${fmt.money(w.payment.net_paid)} already paid — check costs before refunding.`)}</div>}
                    </div>
                </Modal>
            )}

        </div>
    );
}
