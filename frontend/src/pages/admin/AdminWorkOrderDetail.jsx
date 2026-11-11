import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, Stamp, TextField, useAction } from "../../components/ui.jsx";
import { PaymentSummary, QuotationCard, RepairProgress, WoHistory, deviceLabel } from "../../components/repair.jsx";
import ItemsEditor, { itemsValid, toPayload } from "../../components/ItemsEditor.jsx";
import "./admin.css";

const OPEN = ["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "REPAIRING", "TESTING"];

/** Admin prices a technician's draft and sends it to the customer. */
function PriceDraft({ draft, parts, busy, onSend }) {
    const { L, t } = useI18n();
    const [items, setItems] = useState([]);
    const [note, setNote] = useState(draft.note || "");

    useEffect(() => {
        setItems(draft.items.map((i) => {
            const part = parts.find((p) => p.part_id === i.part_id);
            return { ...i, key: i.item_id, unit_price: i.unit_price || (part ? part.unit_price : "") };
        }));
    }, [draft.quotation_id, parts.length]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <section className="action-panel">
            <h2>{L(`ตั้งราคา ${t(`quote.kind.${draft.kind}`)} Rev.${draft.revision}`, `Price ${t(`quote.kind.${draft.kind}`)} Rev.${draft.revision}`)}</h2>
            <p className="muted small">{L("ช่างเสนอรายการมาแล้ว ตรวจสอบ ใส่ราคา แล้วส่งให้ลูกค้าอนุมัติ", "The technician proposed these items. Check them, add prices and send to the customer.")}</p>
            <ItemsEditor items={items} onChange={setItems} parts={parts} withPrice />
            <TextField as="textarea" label={L("ข้อความถึงลูกค้า", "Message to the customer")} value={note} onChange={(e) => setNote(e.target.value)} />
            <div>
                <button type="button" className="btn btn-primary" disabled={busy || !itemsValid(items, true)} onClick={() => onSend(toPayload(items), note)}>
                    {L("ส่งใบเสนอราคาให้ลูกค้า", "Send quotation to customer")}
                </button>
            </div>
        </section>
    );
}

export default function AdminWorkOrderDetail() {
    const { workOrderId } = useParams();
    const { L, t, fmt } = useI18n();
    const wo = useAsync(() => api.repairs.get(workOrderId), [workOrderId]);
    const techs = useAsync(() => api.auth.listTechnicians(), []);
    const parts = useAsync(() => api.inventory.listParts(), []);
    const [run, busy] = useAction();
    const [modal, setModal] = useState(null); // "pay" | "refund" | "handover" | "cancel" | {decide: quotation}
    const [form, setForm] = useState({});

    async function act(fn, message) {
        const updated = await run(fn, message).catch(() => null);
        if (updated) {
            wo.setData(updated);
            setModal(null);
            setForm({});
            parts.reload();
        }
        return updated;
    }

    if (wo.loading && !wo.data) return <Loading />;
    if (wo.error) return <ErrorNotice error={wo.error} onRetry={wo.reload} />;
    const w = wo.data;
    const isOpen = OPEN.includes(w.status);
    const draft = w.quotations.find((q) => q.status === "DRAFT");
    const sent = w.quotations.filter((q) => q.status === "SENT");
    const rejectedToRevise = w.quotations.filter((q) => q.status === "REJECTED" && !w.quotations.some((x) => x.kind === q.kind && x.revision > q.revision));
    const issuable = ["APPROVED", "REPAIRING", "TESTING"].includes(w.status) ? w.parts.filter((p) => p.remaining_qty > 0) : [];
    const canHandover = w.status === "COMPLETED" && w.test_result?.passed && !w.handed_over_at;

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

            <RepairProgress status={w.status} handedOver={Boolean(w.handed_over_at)} />

            <div className="split">
                <div className="stack-lg">
                    {draft && <PriceDraft draft={draft} parts={parts.data || []} busy={busy} onSend={(items, note) => act(() => api.repairs.priceAndSend(draft.quotation_id, { items, note }), L("ส่งใบเสนอราคาแล้ว", "Quotation sent"))} />}

                    {sent.map((q) => (
                        <section key={q.quotation_id} className={`action-panel ${w.source === "WALK_IN" ? "" : "calm"}`}>
                            <h2>{L(`รอลูกค้าตอบ ${t(`quote.kind.${q.kind}`)} Rev.${q.revision}`, `Waiting on ${t(`quote.kind.${q.kind}`)} Rev.${q.revision}`)} · <Money value={q.total} /></h2>
                            {w.source === "WALK_IN" ? (
                                <>
                                    <p className="muted small">{L("ลูกค้า Walk-in ไม่มีบัญชี ให้บันทึกคำตอบแทนลูกค้าเมื่อตกลงที่หน้าร้านหรือทางโทรศัพท์", "Walk-in customers have no account. Record their answer here once they agree in person or by phone.")}</p>
                                    <div className="btn-row">
                                        <button type="button" className="btn btn-primary" onClick={() => { setForm({ approve: true, note: "" }); setModal({ decide: q }); }}>{L("ลูกค้าอนุมัติ", "Customer approved")}</button>
                                        <button type="button" className="btn btn-secondary" onClick={() => { setForm({ approve: false, note: "" }); setModal({ decide: q }); }}>{L("ลูกค้าไม่อนุมัติ", "Customer rejected")}</button>
                                    </div>
                                </>
                            ) : (
                                <p className="muted small">{L("ลูกค้าที่จองผ่านระบบต้องกดอนุมัติเองในหน้าติดตามงานซ่อม", "Customers who booked online approve it themselves from their tracking page.")}</p>
                            )}
                        </section>
                    ))}

                    {rejectedToRevise.length > 0 && !draft && sent.length === 0 && isOpen && (
                        <section className="action-panel">
                            <h2>{L("ลูกค้าไม่อนุมัติราคา", "The customer rejected the quotation")}</h2>
                            {rejectedToRevise.map((q) => (
                                <div key={q.quotation_id} className="stack" style={{ gap: 8 }}>
                                    <p className="small">{L("เหตุผล:", "Reason:")} {q.decision_note || "—"}</p>
                                    <div>
                                        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => api.repairs.reviseQuotation(q.quotation_id), L("สร้างฉบับแก้ไขแล้ว", "New revision created"))}>
                                            {L(`สร้างฉบับแก้ไข Rev.${q.revision + 1}`, `Create Rev.${q.revision + 1}`)}
                                        </button>
                                    </div>
                                </div>
                            ))}
                            <p className="faint small">{L("ฉบับเดิมจะไม่ถูกแก้ทับ เก็บไว้เป็นประวัติราคา", "The old revision is kept as price history — never overwritten.")}</p>
                        </section>
                    )}

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
                            {w.payment.balance > 0
                                ? <div className="notice warn">{L(`ยังค้างชำระ ${fmt.money(w.payment.balance)} ต้องรับชำระให้ครบ หรือให้ Admin อนุมัติข้อยกเว้นพร้อมเหตุผล`, `${fmt.money(w.payment.balance)} still due. Take payment first, or approve an exception with a reason.`)}</div>
                                : <p className="muted small">{L("ซ่อมเสร็จ ทดสอบผ่าน และชำระครบแล้ว", "Repaired, tested and fully paid.")}</p>}
                            <div className="btn-row">
                                {w.payment.balance > 0 && <button type="button" className="btn btn-primary" onClick={() => { setForm({ amount: String(w.payment.balance), method: "CASH" }); setModal("pay"); }}>{L("รับชำระเงิน", "Take payment")}</button>}
                                <button type="button" className={`btn ${w.payment.balance > 0 ? "btn-secondary" : "btn-primary"}`} onClick={() => { setForm({ reason: "" }); setModal("handover"); }}>
                                    {w.payment.balance > 0 ? L("ส่งมอบแบบข้อยกเว้น", "Hand over with exception") : L("ส่งมอบเครื่องแล้ว", "Mark as handed over")}
                                </button>
                            </div>
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
                            <select
                                className="select"
                                aria-label={L("มอบหมายช่าง", "Assign technician")}
                                value={w.technician_id || ""}
                                disabled={busy}
                                onChange={(e) => e.target.value && act(() => api.repairs.assignTechnician(w.work_order_id, e.target.value), L("มอบหมายช่างแล้ว", "Technician assigned"))}
                            >
                                <option value="">{L("— เลือกช่าง —", "— Choose —")}</option>
                                {techs.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                            </select>
                        ) : <p>{w.technician_name || "—"}</p>}
                    </section>

                    <section className="panel stack">
                        <div className="panel-head" style={{ marginBottom: 0 }}>
                            <h3>{L("การเงิน", "Payment")}</h3>
                        </div>
                        <PaymentSummary payment={w.payment} />
                        <div className="btn-row">
                            <button type="button" className="btn btn-secondary btn-sm" disabled={w.payment.balance <= 0 || w.status === "CANCELLED"} onClick={() => { setForm({ amount: String(w.payment.balance), method: "CASH", note: "" }); setModal("pay"); }}>{L("รับชำระ", "Take payment")}</button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={w.payment.net_paid <= 0} onClick={() => { setForm({ amount: "", note: "" }); setModal("refund"); }}>{L("คืนเงิน", "Refund")}</button>
                        </div>
                        {w.payments.length > 0 && (
                            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                                {w.payments.map((p) => <li key={p.payment_id}>{fmt.dateTime(p.created_at)} · {t(`pay.type.${p.type}`)} {fmt.money(p.amount)}{p.type === "PAYMENT" ? ` · ${t(`pay.method.${p.method}`)}` : ""}{p.note ? ` · ${p.note}` : ""}</li>)}
                            </ul>
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
                <Modal title={L("คืนเงิน", "Refund")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-danger" disabled={busy || !form.amount || !form.note?.trim()} onClick={() => act(() => api.payments.refund(w.work_order_id, form), L("บันทึกการคืนเงินแล้ว", "Refund recorded"))}>{L("บันทึกการคืนเงิน", "Record refund")}</button>
                    </>
                )}>
                    <div className="stack">
                        <p className="small muted">{L("คืนได้ไม่เกิน", "Up to")} <Money value={w.payment.net_paid} /></p>
                        <TextField type="number" min="1" step="1" label={L("จำนวนเงิน (บาท)", "Amount (THB)")} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                        <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </div>
                </Modal>
            )}

            {modal === "handover" && (
                <Modal title={L("ส่งมอบเครื่อง", "Hand over")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className="btn btn-primary" disabled={busy || (w.payment.balance > 0 && !form.reason?.trim())} onClick={() => act(() => api.repairs.handover(w.work_order_id, { exceptionReason: form.reason }), L("ส่งมอบเครื่องแล้ว", "Handed over"))}>
                            {L("ยืนยันส่งมอบ", "Confirm handover")}
                        </button>
                    </>
                )}>
                    {w.payment.balance > 0 ? (
                        <div className="stack">
                            <div className="notice warn">{L(`ลูกค้ายังค้าง ${fmt.money(w.payment.balance)} ระบบจะบันทึกผู้อนุมัติ เหตุผล และยอดค้างไว้`, `${fmt.money(w.payment.balance)} is still due. Your name, the reason and the amount will be recorded.`)}</div>
                            <TextField as="textarea" label={L("เหตุผลที่อนุมัติข้อยกเว้น", "Reason for the exception")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={L("เช่น ลูกค้าประจำ จะโอนส่วนที่เหลือภายในศุกร์นี้", "e.g. regular customer, will transfer the rest by Friday")} />
                        </div>
                    ) : <p>{L("ยืนยันว่าลูกค้ารับเครื่องแล้ว", "Confirm the customer has collected the device.")}</p>}
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

            {modal?.decide && (
                <Modal title={form.approve ? L("บันทึกว่าลูกค้าอนุมัติ", "Record approval") : L("บันทึกว่าลูกค้าไม่อนุมัติ", "Record rejection")} onClose={() => setModal(null)} footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                        <button type="button" className={`btn ${form.approve ? "btn-primary" : "btn-danger"}`} disabled={busy} onClick={() => act(() => api.repairs.decideQuotation(modal.decide.quotation_id, { approve: form.approve, note: form.note || L("ลูกค้า walk-in ตอบที่หน้าร้าน", "Walk-in customer answered in person") }), L("บันทึกแล้ว", "Saved"))}>
                            {form.approve ? L("อนุมัติ", "Approve") : L("ไม่อนุมัติ", "Reject")} <Money value={modal.decide.total} />
                        </button>
                    </>
                )}>
                    <TextField as="textarea" label={L("รายละเอียด (เช่น ช่องทางที่ลูกค้าตอบ)", "Details (e.g. how the customer answered)")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </Modal>
            )}
        </div>
    );
}
