import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Stamp, TextField, useAction } from "../../components/ui.jsx";
import { QuotationCard, WoHistory, deviceLabel } from "../../components/repair.jsx";
import ItemsEditor, { blankItem, itemsValid, toPayload } from "../../components/ItemsEditor.jsx";

export default function TechJobDetail() {
    const { workOrderId } = useParams();
    const { L, t, fmt } = useI18n();
    const wo = useAsync(() => api.repairs.get(workOrderId), [workOrderId]);
    const parts = useAsync(() => api.inventory.listParts(), []);
    const [run, busy] = useAction();

    const [diagnosis, setDiagnosis] = useState("");
    const [items, setItems] = useState([blankItem("LABOR")]);
    const [itemsNote, setItemsNote] = useState("");
    const [result, setResult] = useState("");
    const [test, setTest] = useState({ passed: "yes", notes: "" });
    const [showAdditional, setShowAdditional] = useState(false);

    useEffect(() => {
        if (wo.data) setDiagnosis(wo.data.diagnosis || "");
    }, [wo.data?.work_order_id]); // eslint-disable-line react-hooks/exhaustive-deps

    async function act(fn, message, after) {
        const updated = await run(fn, message).catch(() => null);
        if (updated) {
            wo.setData(updated);
            after?.();
        }
    }

    if (wo.loading && !wo.data) return <Loading />;
    if (wo.error) return <ErrorNotice error={wo.error} onRetry={wo.reload} />;
    const w = wo.data;
    const pendingQuote = w.quotations.find((q) => ["DRAFT", "SENT"].includes(q.status));
    const canPropose = (w.status === "DIAGNOSING" && w.diagnosis && !pendingQuote) || (["APPROVED", "REPAIRING"].includes(w.status) && !w.quotations.some((q) => q.kind === "ADDITIONAL" && ["DRAFT", "SENT"].includes(q.status)));

    const proposeForm = (
        <div className="stack">
            <ItemsEditor items={items} onChange={setItems} parts={parts.data || []} />
            <TextField as="textarea" label={L("หมายเหตุถึงร้าน (ไม่บังคับ)", "Note for the shop (optional)")} value={itemsNote} onChange={(e) => setItemsNote(e.target.value)} />
            <div>
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !itemsValid(items, false)}
                    onClick={() => act(
                        () => api.repairs.proposeItems(w.work_order_id, { items: toPayload(items), note: itemsNote }),
                        L("ส่งรายการให้ร้านตั้งราคาแล้ว", "Items sent for pricing"),
                        () => { setItems([blankItem("LABOR")]); setItemsNote(""); setShowAdditional(false); }
                    )}
                >
                    {L("ส่งให้ร้านตั้งราคา", "Send for pricing")}
                </button>
            </div>
        </div>
    );

    return (
        <div className="stack-lg">
            <Link to="/tech" className="small">← {L("งานของฉัน", "My jobs")}</Link>
            <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                    <p className="faint small">{t(`source.${w.source}`)}{w.booking_number ? ` · ${w.booking_number}` : ""}</p>
                    <h1 className="num">{w.work_order_number}</h1>
                    <p>{deviceLabel(w)} · {w.service_name}</p>
                </div>
                <Stamp kind="wo" status={w.status} />
            </div>

            <div className="split">
                <div className="stack-lg">
                    {/* The one thing to do next */}
                    {w.status === "PENDING" && (
                        <section className="action-panel">
                            <h2>{L("เริ่มตรวจเช็กเครื่อง", "Start the diagnosis")}</h2>
                            <p className="muted small">{L("กดเมื่อเริ่มเปิดเครื่องตรวจ ลูกค้าจะเห็นสถานะ “กำลังตรวจเช็ก”", "Customers will see “Diagnosing”.")}</p>
                            <div><button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => api.repairs.startDiagnosis(w.work_order_id), L("เริ่มตรวจแล้ว", "Diagnosis started"))}>{L("เริ่มตรวจเช็ก", "Start diagnosis")}</button></div>
                        </section>
                    )}

                    {w.status === "DIAGNOSING" && (
                        <section className="action-panel">
                            <h2>{L("ผลตรวจและรายการที่ต้องซ่อม", "Diagnosis and proposed work")}</h2>
                            <TextField as="textarea" label={L("ผลการตรวจ", "Diagnosis")} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder={L("เช่น SSD เสีย อ่านไม่ได้ บอร์ดและจอปกติ", "e.g. SSD failed, board and screen OK")} />
                            <div>
                                <button type="button" className="btn btn-secondary" disabled={busy || !diagnosis.trim() || diagnosis === w.diagnosis} onClick={() => act(() => api.repairs.saveDiagnosis(w.work_order_id, diagnosis), L("บันทึกผลตรวจแล้ว", "Diagnosis saved"))}>
                                    {L("บันทึกผลตรวจ", "Save diagnosis")}
                                </button>
                            </div>
                            {w.quotations.some((q) => q.status === "REJECTED") && !pendingQuote && (
                                <div className="notice warn">{L("ลูกค้าไม่อนุมัติราคาฉบับก่อน ดูเหตุผลด้านล่างแล้วเสนอรายการใหม่ หรือรอร้านแก้ใบเสนอราคา", "The customer rejected the last quotation. Check their note below and propose new items, or wait for the shop to revise it.")}</div>
                            )}
                            {pendingQuote && <div className="notice info">{L("ส่งรายการแล้ว รอผู้ดูแลร้านตั้งราคาและส่งให้ลูกค้า", "Items sent. Waiting for the admin to price and send them.")}</div>}
                            {canPropose && (
                                <>
                                    <h3 style={{ fontSize: "var(--fs-md)" }}>{L("เสนอรายการซ่อมและอะไหล่", "Propose repair items and parts")}</h3>
                                    <p className="muted small">{L("ไม่ต้องใส่ราคา ร้านจะตั้งราคาก่อนส่งให้ลูกค้าอนุมัติ", "No prices needed — the admin prices it before the customer approves.")}</p>
                                    {proposeForm}
                                </>
                            )}
                            {!w.diagnosis && <p className="small faint">{L("บันทึกผลตรวจก่อน จึงจะเสนอรายการได้", "Save the diagnosis first to propose items.")}</p>}
                        </section>
                    )}

                    {w.status === "WAITING_APPROVAL" && (
                        <section className="action-panel calm">
                            <h2>{L("รอลูกค้าอนุมัติราคา", "Waiting for the customer to approve")}</h2>
                            <p className="muted small">{L("ยังไม่ต้องลงมือซ่อม งานจะขึ้นว่า “อนุมัติแล้ว” เมื่อลูกค้าตอบ", "Don't start yet — the job turns “Approved” when the customer answers.")}</p>
                        </section>
                    )}

                    {w.status === "APPROVED" && (
                        <section className="action-panel">
                            <h2>{L("ลูกค้าอนุมัติแล้ว เริ่มซ่อมได้", "Approved — start the repair")}</h2>
                            {w.parts.some((p) => p.remaining_qty > 0) && (
                                <div className="notice info">{L("ขอเบิกอะไหล่จากผู้ดูแลร้านก่อนเริ่ม (เบิกได้เฉพาะรายการที่อนุมัติ)", "Ask the admin to issue the approved parts before you start.")}</div>
                            )}
                            <div><button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => api.repairs.startRepair(w.work_order_id), L("เริ่มซ่อมแล้ว", "Repair started"))}>{L("เริ่มซ่อม", "Start repair")}</button></div>
                        </section>
                    )}

                    {w.status === "REPAIRING" && (
                        <section className="action-panel">
                            <h2>{L("บันทึกผลการซ่อม", "Record the repair")}</h2>
                            <TextField as="textarea" label={L("สิ่งที่ทำไป", "What you did")} value={result} onChange={(e) => setResult(e.target.value)} placeholder={L("เช่น เปลี่ยน SSD 512GB ติดตั้ง Windows และย้ายข้อมูลครบ", "e.g. replaced SSD, installed Windows, restored data")} />
                            <div><button type="button" className="btn btn-primary" disabled={busy || !result.trim()} onClick={() => act(() => api.repairs.recordResult(w.work_order_id, result), L("บันทึกแล้ว ไปขั้นทดสอบ", "Saved — now testing"))}>{L("ซ่อมเสร็จ ไปทดสอบ", "Done — move to testing")}</button></div>
                        </section>
                    )}

                    {w.status === "TESTING" && (
                        <section className="action-panel">
                            <h2>{L("ผลการทดสอบ", "Test result")}</h2>
                            <fieldset className="radio-row" style={{ border: 0, padding: 0, margin: 0 }}>
                                <legend className="visually-hidden">{L("ผลการทดสอบ", "Test result")}</legend>
                                <label><input type="radio" name="passed" checked={test.passed === "yes"} onChange={() => setTest({ ...test, passed: "yes" })} />{L("ผ่าน — ส่งมอบได้", "Passed — ready for handover")}</label>
                                <label><input type="radio" name="passed" checked={test.passed === "no"} onChange={() => setTest({ ...test, passed: "no" })} />{L("ไม่ผ่าน — กลับไปซ่อม", "Failed — back to repair")}</label>
                            </fieldset>
                            <TextField as="textarea" label={L("รายละเอียดการทดสอบ", "Test notes")} value={test.notes} onChange={(e) => setTest({ ...test, notes: e.target.value })} placeholder={L("เช่น บูต 9 วินาที รันทดสอบ 30 นาที ไม่ร้อนเกิน", "e.g. boots in 9s, 30-min stress test OK")} />
                            <div><button type="button" className="btn btn-primary" disabled={busy || !test.notes.trim()} onClick={() => act(() => api.repairs.recordTest(w.work_order_id, { passed: test.passed === "yes", notes: test.notes }), L("บันทึกผลทดสอบแล้ว", "Test recorded"))}>{L("บันทึกผลทดสอบ", "Save test result")}</button></div>
                        </section>
                    )}

                    {["APPROVED", "REPAIRING"].includes(w.status) && (
                        <section className="stack">
                            <div className="panel-head" style={{ marginBottom: 0 }}>
                                <h2>{L("พบปัญหาเพิ่มเติม?", "Found another problem?")}</h2>
                                {canPropose && !showAdditional && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdditional(true)}>{L("เสนองานเพิ่มเติม", "Propose additional work")}</button>}
                            </div>
                            <p className="muted small">{L("งานเดิมที่อนุมัติแล้วทำต่อได้ งานเพิ่มต้องรอลูกค้าอนุมัติก่อน", "Keep going with approved work. Extra work waits for the customer's approval.")}</p>
                            {showAdditional && canPropose && proposeForm}
                        </section>
                    )}

                    <section className="stack">
                        <h2>{L("ใบเสนอราคา", "Quotations")}</h2>
                        {w.quotations.length === 0 && <p className="muted small">{L("ยังไม่มี", "None yet")}</p>}
                        {w.quotations.map((q) => <QuotationCard key={q.quotation_id} quotation={q} superseded={q.status === "REJECTED"} />)}
                    </section>
                </div>

                <aside className="stack-lg">
                    <section className="panel">
                        <dl className="facts">
                            <dt>{L("ลูกค้า", "Customer")}</dt><dd>{w.customer_name}</dd>
                            <dt>{L("เครื่อง", "Device")}</dt><dd>{[w.device_type, w.brand, w.model].filter(Boolean).join(" · ")}</dd>
                            {w.serial_number && (<><dt>Serial</dt><dd>{w.serial_number}</dd></>)}
                            <dt>{L("อาการ", "Symptom")}</dt><dd>{w.reported_symptom}</dd>
                            {w.accessories && (<><dt>{L("ของที่ฝาก", "Accessories")}</dt><dd>{w.accessories}</dd></>)}
                            {w.diagnosis && w.status !== "DIAGNOSING" && (<><dt>{L("ผลตรวจ", "Diagnosis")}</dt><dd>{w.diagnosis}</dd></>)}
                            {w.repair_result && (<><dt>{L("ผลซ่อม", "Repair")}</dt><dd>{w.repair_result}</dd></>)}
                            {w.test_result && (<><dt>{L("ทดสอบ", "Test")}</dt><dd>{w.test_result.passed ? L("ผ่าน", "Passed") : L("ไม่ผ่าน", "Failed")} · {w.test_result.notes}</dd></>)}
                        </dl>
                    </section>
                    {w.parts.length > 0 && (
                        <section className="stack">
                            <h3>{L("อะไหล่ที่อนุมัติ", "Approved parts")}</h3>
                            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                                {w.parts.map((p) => (
                                    <li key={p.part_id}>{p.name} — {L("เบิกแล้ว", "issued")} {p.issued_qty}/{p.approved_qty}</li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <section className="stack">
                        <h3>{L("ประวัติ", "History")}</h3>
                        <WoHistory history={w.history} />
                        <p className="faint small">{L("สร้างเมื่อ", "Opened")} {fmt.dateTime(w.created_at)}</p>
                    </section>
                </aside>
            </div>
        </div>
    );
}
