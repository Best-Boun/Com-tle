import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, PageHead, TextField, useAction } from "../../components/ui.jsx";
import "./admin.css";

export default function AdminInventory() {
    const { L, t, fmt } = useI18n();
    const [tab, setTab] = useState("parts");
    const parts = useAsync(() => api.inventory.listParts(), []);
    const moves = useAsync(() => api.inventory.listMovements(), []);
    const [run, busy] = useAction();
    const [modal, setModal] = useState(null);
    const [form, setForm] = useState({});

    async function submit() {
        const call = modal.type === "receive"
            ? () => api.inventory.receive(modal.part.part_id, form)
            : () => api.inventory.createPart(form);
        const ok = await run(call, modal.type === "receive" ? L("รับของเข้าสต็อกแล้ว", "Stock received") : L("เพิ่มอะไหล่แล้ว", "Part added")).catch(() => null);
        if (ok) {
            setModal(null);
            parts.reload();
            moves.reload();
        }
    }

    return (
        <div>
            <PageHead
                title={L("คลังอะไหล่", "Parts stock")}
                lede={L("Inventory เป็นเจ้าของยอดสต็อก การเบิกให้ใบงานทำจากหน้าใบงานและเบิกได้เฉพาะที่ลูกค้าอนุมัติ", "Inventory owns the stock. Parts are issued from a work order, only within what the customer approved.")}
                actions={<button type="button" className="btn btn-primary" onClick={() => { setForm({ sku: "", name: "", unit_price: "", reorder_level: "2" }); setModal({ type: "new" }); }}>{L("เพิ่มอะไหล่", "Add part")}</button>}
            />
            <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
                <button type="button" role="tab" className="tab" aria-selected={tab === "parts"} onClick={() => setTab("parts")}>{L("รายการอะไหล่", "Parts")}</button>
                <button type="button" role="tab" className="tab" aria-selected={tab === "moves"} onClick={() => setTab("moves")}>{L("ประวัติรับเข้า / เบิก / คืน", "Movements")}</button>
            </div>

            {tab === "parts" && (
                <>
                    {parts.loading && !parts.data && <Loading />}
                    <ErrorNotice error={parts.error} onRetry={parts.reload} />
                    {parts.data && (
                        <div className="table-wrap">
                            <table className="table">
                                <thead><tr><th>SKU</th><th>{L("ชื่อ", "Name")}</th><th className="right">{L("ราคาขาย", "Price")}</th><th className="right">{L("คงเหลือ", "In stock")}</th><th className="right">{L("จุดสั่งซื้อ", "Reorder at")}</th><th /></tr></thead>
                                <tbody>
                                    {parts.data.map((p) => (
                                        <tr key={p.part_id}>
                                            <td className="num faint">{p.sku}</td>
                                            <td>{p.name}</td>
                                            <td className="right"><Money value={p.unit_price} /></td>
                                            <td className="right num">
                                                {p.stock === 0 ? <span className="badge tone-red">{L("หมด", "Out")}</span> : p.stock <= p.reorder_level ? <span className="badge tone-amber">{p.stock}</span> : p.stock}
                                            </td>
                                            <td className="right num faint">{p.reorder_level}</td>
                                            <td className="right"><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setForm({ qty: "", note: "" }); setModal({ type: "receive", part: p }); }}>{L("รับเข้า", "Receive")}</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {tab === "moves" && (
                <>
                    {moves.loading && !moves.data && <Loading />}
                    <ErrorNotice error={moves.error} onRetry={moves.reload} />
                    {moves.data && (
                        <div className="table-wrap">
                            <table className="table">
                                <thead><tr><th>{L("เวลา", "When")}</th><th>{L("ประเภท", "Type")}</th><th>{L("อะไหล่", "Part")}</th><th className="right">{L("จำนวน", "Qty")}</th><th>{L("ใบงาน", "Work order")}</th><th>{L("โดย", "By")}</th><th>{t("common.notes")}</th></tr></thead>
                                <tbody>
                                    {moves.data.map((m) => (
                                        <tr key={m.movement_id}>
                                            <td className="num">{fmt.dateTime(m.created_at)}</td>
                                            <td><span className={`badge tone-${m.type === "ISSUE" ? "amber" : m.type === "RECEIVE" ? "green" : "blue"}`}>{t(`move.${m.type}`)}</span></td>
                                            <td>{m.part_name}</td>
                                            <td className="right num">{m.type === "ISSUE" ? "−" : "+"}{m.qty}</td>
                                            <td className="num">{m.work_order_number || "—"}</td>
                                            <td>{m.by_name}</td>
                                            <td className="muted">{m.note || ""}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {modal && (
                <Modal
                    title={modal.type === "receive" ? L(`รับ ${modal.part.name} เข้าสต็อก`, `Receive ${modal.part.name}`) : L("เพิ่มอะไหล่ใหม่", "Add a part")}
                    onClose={() => setModal(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{t("common.save")}</button>
                        </>
                    )}
                >
                    {modal.type === "receive" ? (
                        <div className="form-grid">
                            <p className="small muted">{L("คงเหลือตอนนี้", "Currently")} {modal.part.stock}</p>
                            <TextField type="number" min="1" step="1" label={L("จำนวนที่รับเข้า", "Quantity received")} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                            <TextField label={t("common.notes")} placeholder={L("เช่น เลขใบส่งของ", "e.g. delivery note number")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                        </div>
                    ) : (
                        <div className="form-grid">
                            <div className="form-grid two">
                                <TextField label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                                <TextField type="number" min="0" step="1" label={L("ราคาขาย (บาท)", "Price (THB)")} value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
                            </div>
                            <TextField label={L("ชื่ออะไหล่", "Name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            <TextField type="number" min="0" step="1" label={L("แจ้งเตือนเมื่อเหลือ", "Warn when stock is at")} value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
