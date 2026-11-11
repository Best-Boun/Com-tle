import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, Stamp, TextField, useAction } from "../../components/ui.jsx";
import { PaymentSummary, QuotationCard, RepairProgress, WoHistory, deviceLabel } from "../../components/repair.jsx";

export default function RepairDetail() {
    const { workOrderId } = useParams();
    const { L, t, fmt } = useI18n();
    const wo = useAsync(() => api.repairs.get(workOrderId), [workOrderId]);
    const [rejecting, setRejecting] = useState(null);
    const [note, setNote] = useState("");
    const [run, busy] = useAction();

    async function decide(quotation, approve) {
        const updated = await run(
            () => api.repairs.decideQuotation(quotation.quotation_id, { approve, note }),
            approve ? L("อนุมัติแล้ว ร้านจะเริ่มซ่อม", "Approved — the shop will start the repair") : L("ส่งคำตอบให้ร้านแล้ว", "Sent to the shop")
        ).catch(() => null);
        if (updated) wo.setData(updated);
        setRejecting(null);
        setNote("");
    }

    if (wo.loading && !wo.data) return <Loading />;
    if (wo.error) return <ErrorNotice error={wo.error} onRetry={wo.reload} />;
    const w = wo.data;
    const pending = w.quotations.filter((q) => q.status === "SENT");
    const shownStatus = w.handed_over_at ? "HANDED_OVER" : w.status;

    return (
        <div className="stack-lg">
            <Link to="/my/repairs" className="small">← {L("งานซ่อมของฉัน", "My repairs")}</Link>

            <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                    <p className="faint small">{L("ใบงานซ่อม", "Repair ticket")}{w.booking_number ? ` · ${L("จาก", "from")} ${w.booking_number}` : ""}</p>
                    <h1 className="num">{w.work_order_number}</h1>
                    <p>{deviceLabel(w)} · {w.service_name}</p>
                </div>
                <Stamp kind="wo" status={shownStatus} />
            </div>

            <RepairProgress status={w.status} handedOver={Boolean(w.handed_over_at)} />

            {pending.length > 0 && (
                <div className="notice warn" role="status">
                    {L("ร้านส่งใบเสนอราคามาแล้ว กรุณาตรวจสอบและอนุมัติก่อนร้านเริ่มซ่อม", "The shop sent a quotation. Please review and approve it so the repair can start.")}
                </div>
            )}
            {w.status === "COMPLETED" && !w.handed_over_at && (
                <div className="notice ok">
                    {w.payment.balance > 0
                        ? L(`ซ่อมเสร็จและทดสอบแล้ว ชำระยอดค้าง ${fmt.money(w.payment.balance)} แล้วมารับเครื่องได้เลย`, `Repair done and tested. Pay the remaining ${fmt.money(w.payment.balance)} and pick up your device.`)
                        : L("ซ่อมเสร็จและทดสอบแล้ว มารับเครื่องได้ที่ร้าน", "Repair done and tested — ready for pick-up.")}
                </div>
            )}
            {w.status === "CANCELLED" && <div className="notice error">{L("งานนี้ถูกยกเลิก", "This repair was cancelled")}{w.cancellation?.reason ? ` — ${w.cancellation.reason}` : ""}</div>}

            <div className="split">
                <div className="stack-lg">
                    <section className="stack">
                        <h2>{L("ใบเสนอราคา", "Quotations")}</h2>
                        {w.quotations.filter((q) => q.status !== "DRAFT").length === 0 && (
                            <p className="muted">{L("ช่างกำลังตรวจเช็ก ร้านจะส่งใบเสนอราคามาให้อนุมัติที่นี่", "The technician is checking your device. The quotation will appear here.")}</p>
                        )}
                        {w.quotations.filter((q) => q.status !== "DRAFT").map((q) => (
                            <QuotationCard key={q.quotation_id} quotation={q} superseded={q.status === "REJECTED"}>
                                {q.status === "SENT" && (
                                    <div className="btn-row">
                                        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(q, true)}>
                                            {L("อนุมัติ", "Approve")} <Money value={q.total} />
                                        </button>
                                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRejecting(q)}>{L("ไม่อนุมัติ", "Reject")}</button>
                                    </div>
                                )}
                            </QuotationCard>
                        ))}
                    </section>

                    <section className="stack">
                        <h2>{L("รายละเอียดเครื่อง", "Device")}</h2>
                        <dl className="facts">
                            <dt>{L("เครื่อง", "Device")}</dt>
                            <dd>{[w.device_type, w.brand, w.model].filter(Boolean).join(" · ")}</dd>
                            {w.serial_number && (<><dt>Serial</dt><dd>{w.serial_number}</dd></>)}
                            <dt>{L("อาการที่แจ้ง", "Reported")}</dt>
                            <dd>{w.reported_symptom}</dd>
                            {w.accessories && (<><dt>{L("อุปกรณ์ที่ฝาก", "Left with us")}</dt><dd>{w.accessories}</dd></>)}
                            {w.diagnosis && (<><dt>{L("ผลตรวจ", "Diagnosis")}</dt><dd>{w.diagnosis}</dd></>)}
                            {w.repair_result && (<><dt>{L("ผลการซ่อม", "Repair")}</dt><dd>{w.repair_result}</dd></>)}
                            {w.test_result && (<><dt>{L("ผลทดสอบ", "Test")}</dt><dd>{w.test_result.passed ? L("ผ่าน", "Passed") : L("ไม่ผ่าน", "Failed")} — {w.test_result.notes}</dd></>)}
                        </dl>
                    </section>
                </div>

                <aside className="stack-lg">
                    <section className="panel stack">
                        <h3>{L("การชำระเงิน", "Payment")}</h3>
                        <PaymentSummary payment={w.payment} />
                        {w.payments.length > 0 && (
                            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                                {w.payments.map((p) => (
                                    <li key={p.payment_id}>{fmt.date(p.created_at)} · {t(`pay.type.${p.type}`)} {fmt.money(p.amount)}{p.type === "PAYMENT" ? ` (${t(`pay.method.${p.method}`)})` : ""}</li>
                                ))}
                            </ul>
                        )}
                        <p className="small faint">{L("ชำระที่ร้านได้ทั้งเงินสด โอน และบัตร แบ่งชำระได้", "Pay at the shop by cash, transfer or card. Part payments are fine.")}</p>
                    </section>
                    <section className="stack">
                        <h3>{L("ความคืบหน้า", "Updates")}</h3>
                        <WoHistory history={w.history} />
                    </section>
                </aside>
            </div>

            {rejecting && (
                <Modal
                    title={L(`ไม่อนุมัติ Rev.${rejecting.revision}?`, `Reject Rev.${rejecting.revision}?`)}
                    onClose={() => setRejecting(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setRejecting(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide(rejecting, false)}>{L("ไม่อนุมัติ", "Reject")}</button>
                        </>
                    )}
                >
                    <div className="stack">
                        <p className="muted small">{L("ร้านจะติดต่อกลับและอาจส่งใบเสนอราคาฉบับใหม่ ใบเดิมจะถูกเก็บไว้เป็นประวัติ", "The shop may send a new revision. This one stays in the history.")}</p>
                        <TextField as="textarea" label={L("บอกร้านว่าอยากปรับอะไร", "Tell the shop what you'd like changed")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("เช่น ขอเป็น SSD 512GB แทน", "e.g. could you use a 512GB SSD instead?")} />
                    </div>
                </Modal>
            )}
        </div>
    );
}
