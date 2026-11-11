import { useI18n } from "../i18n/I18nProvider.jsx";
import { Money } from "./ui.jsx";

let seq = 0;
export function blankItem(type = "LABOR") {
    seq += 1;
    return { key: `new-${seq}`, type, description: "", part_id: "", qty: 1, unit_price: "" };
}

/**
 * Editable list of quotation items.
 * - Technician: no prices (withPrice=false)
 * - Admin: sets prices (withPrice=true)
 */
export default function ItemsEditor({ items, onChange, parts = [], withPrice = false }) {
    const { L, t } = useI18n();
    const update = (index, patch) => onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    const remove = (index) => onChange(items.filter((_, i) => i !== index));
    const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);

    return (
        <div className="stack" style={{ gap: 12 }}>
            {items.map((it, index) => (
                <div key={it.key || it.item_id} className="item-row">
                    <select className="select" aria-label={L("ประเภท", "Type")} value={it.type} onChange={(e) => update(index, { type: e.target.value, part_id: "" })}>
                        <option value="LABOR">{t("item.LABOR")}</option>
                        <option value="PART">{t("item.PART")}</option>
                    </select>
                    {it.type === "PART" ? (
                        <select
                            className="select item-desc"
                            aria-label={L("อะไหล่", "Part")}
                            value={it.part_id || ""}
                            onChange={(e) => {
                                const part = parts.find((p) => p.part_id === e.target.value);
                                update(index, { part_id: e.target.value, description: part?.name || "", unit_price: withPrice && part && !it.unit_price ? part.unit_price : it.unit_price });
                            }}
                        >
                            <option value="">{L("เลือกอะไหล่", "Choose a part")}</option>
                            {parts.map((p) => (
                                <option key={p.part_id} value={p.part_id}>{p.name} ({L("เหลือ", "stock")} {p.stock})</option>
                            ))}
                        </select>
                    ) : (
                        <input className="input item-desc" aria-label={L("รายละเอียด", "Description")} placeholder={L("เช่น ค่าแรงเปลี่ยน SSD", "e.g. SSD replacement labour")} value={it.description} onChange={(e) => update(index, { description: e.target.value })} />
                    )}
                    <input className="input item-qty num" type="number" min="1" step="1" aria-label={L("จำนวน", "Qty")} value={it.qty} onChange={(e) => update(index, { qty: e.target.value })} />
                    {withPrice && (
                        <input className="input item-price num" type="number" min="0" step="1" aria-label={L("ราคาต่อหน่วย (บาท)", "Unit price (THB)")} placeholder={L("ราคา", "Price")} value={it.unit_price} onChange={(e) => update(index, { unit_price: e.target.value })} />
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={L("ลบรายการ", "Remove item")} onClick={() => remove(index)} disabled={items.length === 1}>✕</button>
                </div>
            ))}
            <div className="cluster" style={{ justifyContent: "space-between" }}>
                <div className="btn-row">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...items, blankItem("LABOR")])}>+ {t("item.LABOR")}</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...items, blankItem("PART")])}>+ {t("item.PART")}</button>
                </div>
                {withPrice && <strong>{L("ยอดรวม", "Total")} <Money value={total} /></strong>}
            </div>
        </div>
    );
}

export function itemsValid(items, withPrice) {
    return items.length > 0 && items.every((i) =>
        String(i.description).trim()
        && (i.type !== "PART" || i.part_id)
        && Number.isInteger(Number(i.qty)) && Number(i.qty) >= 1
        && (!withPrice || (i.unit_price !== "" && Number.isInteger(Number(i.unit_price)) && Number(i.unit_price) >= 0))
    );
}

export function toPayload(items) {
    return items.map((i) => ({
        item_id: i.item_id,
        type: i.type,
        description: String(i.description).trim(),
        part_id: i.type === "PART" ? i.part_id : null,
        qty: Number(i.qty),
        unit_price: Number(i.unit_price || 0)
    }));
}
