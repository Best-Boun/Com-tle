import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, Stamp, useAction } from "../../components/ui.jsx";
import { OptionPicker, PaymentSummary, PickupNote, QuotationCard, RepairProgress, WoHistory, deviceFacts, deviceLabel } from "../../components/repair.jsx";
import Checkout from "../../components/Checkout.jsx";
import { WarrantyNotice } from "../../components/Warranty.jsx";

export default function RepairDetail() {
    const { workOrderId } = useParams();
    const { L, t, fmt, lang } = useI18n();
    const wo = useAsync(() => api.repairs.get(workOrderId), [workOrderId]);
    const [paying, setPaying] = useState(false);
    const [run, busy] = useAction();

    async function choose(quotation, option, note) {
        const message = option.kind === "NO_REPAIR"
            ? L("รับทราบ ไม่ซ่อม มารับเครื่องคืนได้เลย", "Noted — no repair. You can collect your device.")
            : option.kind === "SKIP_EXTRA"
                ? L("รับทราบ ร้านจะซ่อมต่อตามเดิม", "Noted — the shop carries on as agreed.")
                : L("ยืนยันแล้ว ร้านจะเริ่มซ่อม", "Confirmed — the shop will start the repair");
        const updated = await run(
            () => api.repairs.decideQuotation(quotation.quotation_id, { option_id: option.option_id, note: note.trim() || null }),
            message
        ).catch(() => null);
        if (updated) wo.setData(updated);
    }

    if (wo.loading && !wo.data) return <Loading />;
    if (wo.error) return <ErrorNotice error={wo.error} onRetry={wo.reload} />;
    const w = wo.data;
    const pending = w.quotations.filter((q) => q.status === "SENT");
    const shownStatus = w.handed_over_at ? "HANDED_OVER" : w.status;
    const canPayOnline = w.status !== "CANCELLED" && w.payment.balance > 0;

    return (
        <div className="stack-lg">
            <Link to="/my/repairs" className="small">← {L("งานซ่อมของฉัน", "My repairs")}</Link>

            <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                    <p className="faint small">{L("ใบงานซ่อม", "Repair ticket")}{w.booking_number ? ` · ${L("จาก", "from")} ${w.booking_number}` : ""}</p>
                    <h1 className="num">{w.work_order_number}</h1>
                    <p>{deviceLabel(w, lang)} · {w.service_name}</p>
                </div>
                <Stamp kind="wo" status={shownStatus} />
            </div>

            <RepairProgress status={w.status} handedOver={Boolean(w.handed_over_at)} declined={w.repair_declined} />
            <WarrantyNotice w={w} base="/my/repairs" />

            {pending.length > 0 && (
                <div className="notice warn" role="status">
                    {L("ช่างตรวจเสร็จแล้ว อ่านผลตรวจแล้วเลือก 1 ตัวเลือกด้านล่าง ร้านจะเริ่มซ่อมเมื่อคุณเลือก", "The technician has checked your device. Read the result and pick one option below; the repair starts once you choose.")}
                </div>
            )}
            {w.status === "COMPLETED" && !w.handed_over_at && w.repair_declined && (
                <div className="notice ok">
                    {w.payment.balance > 0
                        ? L(`คุณเลือกไม่ซ่อม มารับเครื่องคืนได้ที่ร้าน ค่าตรวจเช็ก ${fmt.money(w.payment.balance)}`, `You chose not to repair. Collect your device at the shop; the inspection fee is ${fmt.money(w.payment.balance)}.`)
                        : L("คุณเลือกไม่ซ่อม มารับเครื่องคืนได้ที่ร้าน", "You chose not to repair. Collect your device at the shop.")}
                </div>
            )}
            {w.status === "COMPLETED" && !w.handed_over_at && !w.repair_declined && (
                <div className="notice ok">
                    {w.payment.unavailable
                        ? L("ซ่อมเสร็จและทดสอบแล้ว ติดต่อร้านเพื่อรับเครื่องได้เลย", "Repair done and tested — contact the shop to pick up your device.")
                        : w.payment.balance > 0
                        ? L(`ซ่อมเสร็จและทดสอบแล้ว ชำระยอดค้าง ${fmt.money(w.payment.balance)} แล้วมารับเครื่องได้เลย`, `Repair done and tested. Pay the remaining ${fmt.money(w.payment.balance)} and pick up your device.`)
                        : L("ซ่อมเสร็จและทดสอบแล้ว มารับเครื่องได้ที่ร้าน", "Repair done and tested — ready for pick-up.")}
                </div>
            )}
            <PickupNote workOrder={w} />
            {w.status === "WAITING_PARTS" && (
                <div className="notice info">{L("ร้านกำลังรออะไหล่ จะเริ่มซ่อมทันทีที่อะไหล่มาถึง", "The shop is waiting for parts and will start as soon as they arrive.")}</div>
            )}
            {canPayOnline && pending.length === 0 && (
                <div className="notice info pay-cta" role="status">
                    <span>{L(`ยอดที่ต้องชำระ ${fmt.money(w.payment.balance)} ชำระออนไลน์ได้เลย`, `${fmt.money(w.payment.balance)} is due — you can pay online now.`)}</span>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying(true)}>{L("ชำระเงิน", "Pay now")}</button>
                </div>
            )}
            {w.status === "CANCELLED" && <div className="notice error">{L("งานนี้ถูกยกเลิก", "This repair was cancelled")}{w.cancellation?.reason ? ` — ${w.cancellation.reason}` : ""}</div>}

            <div className="split">
                <div className="stack-lg">
                    <section className="stack">
                        <h2>{L("ผลตรวจและตัวเลือก", "Diagnosis and options")}</h2>
                        {w.diagnosis && <p className="notice info" style={{ margin: 0 }}><strong>{L("ผลตรวจ:", "Diagnosis:")}</strong> {w.diagnosis}</p>}
                        {w.quotations.filter((q) => q.status !== "DRAFT").length === 0 && (
                            <p className="muted">{w.status === "PENDING"
                                ? L("ร้านรับเครื่องแล้ว รอช่างเริ่มตรวจเช็ก ตัวเลือกพร้อมราคาจะส่งมาที่นี่", "Your device is in. A technician will start checking it; priced options will appear here.")
                                : L("ช่างกำลังตรวจเช็ก ตัวเลือกพร้อมราคาจะส่งมาที่นี่ และแจ้งทางอีเมล", "The technician is checking your device. Priced options will appear here.")}</p>
                        )}
                        {w.quotations.filter((q) => q.status !== "DRAFT").map((q) => (
                            q.status === "SENT" && q.options?.length > 0 ? (
                                <section key={q.quotation_id} className="quote is-sent">
                                    <header className="quote-head">
                                        <strong>{t(`quote.kind.${q.kind}`)} Rev.{q.revision}</strong>
                                        <span className="small faint">{L("เลือก 1 ตัวเลือก", "Pick one option")}</span>
                                    </header>
                                    <div className="quote-body">
                                        {q.note && <p className="small">{q.note}</p>}
                                        <OptionPicker
                                            quotation={q}
                                            busy={busy}
                                            onChoose={(option, note) => choose(q, option, note)}
                                            noteLabel={L("ข้อความถึงร้าน (ไม่บังคับ)", "Message to the shop (optional)")}
                                        />
                                    </div>
                                </section>
                            ) : (
                                <QuotationCard key={q.quotation_id} quotation={q} superseded={q.status === "REJECTED"} />
                            )
                        ))}
                    </section>

                    <section className="stack">
                        <h2>{L("รายละเอียดเครื่อง", "Device")}</h2>
                        <dl className="facts">
                            <dt>{L("เครื่อง", "Device")}</dt>
                            <dd>{deviceFacts(w, lang)}</dd>
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
                        {canPayOnline && (
                            <button type="button" className="btn btn-primary" onClick={() => setPaying(true)}>
                                {L("ชำระเงินออนไลน์", "Pay online")} <Money value={w.payment.balance} />
                            </button>
                        )}
                        <p className="small faint">{L("ชำระออนไลน์ด้วยพร้อมเพย์หรือบัตร หรือชำระที่ร้านด้วยเงินสด โอน และบัตร", "Pay online by PromptPay or card, or at the shop by cash, transfer or card.")}</p>
                    </section>
                    <section className="stack">
                        <h3>{L("ความคืบหน้า", "Updates")}</h3>
                        <WoHistory history={w.history} />
                    </section>
                </aside>
            </div>

            {paying && (
                <Checkout workOrder={w} onClose={() => setPaying(false)} onPaid={(updated) => wo.setData(updated)} />
            )}

        </div>
    );
}
