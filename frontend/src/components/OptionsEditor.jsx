import { useI18n } from "../i18n/I18nProvider.jsx";
import ItemsEditor, { blankItem, itemsValid, toPayload } from "./ItemsEditor.jsx";
import { Money } from "./ui.jsx";

let seq = 0;
export function blankOption() {
    seq += 1;
    return { key: `option-${seq}`, title: "", description: "", items: [blankItem("LABOR")] };
}

const MAX_OPTIONS = 5;
const totalOf = (items) => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);

/**
 * The technician writes 1-5 priced repair options in words the customer
 * understands. The system adds "no repair" (the inspection fee) by itself.
 */
export default function OptionsEditor({ options, onChange, parts = [], additional = false }) {
    const { L } = useI18n();
    const update = (index, patch) => onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
    const remove = (index) => onChange(options.filter((_, i) => i !== index));

    return (
        <div className="stack">
            {options.map((o, index) => (
                <section key={o.key} className="option-editor" aria-label={L(`ตัวเลือกที่ ${index + 1}`, `Option ${index + 1}`)}>
                    <div className="cluster" style={{ justifyContent: "space-between" }}>
                        <strong>{L(`ตัวเลือกที่ ${index + 1}`, `Option ${index + 1}`)}</strong>
                        <span className="cluster" style={{ gap: 8 }}>
                            <strong><Money value={totalOf(o.items)} /></strong>
                            {options.length > 1 && (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(index)}>{L("ลบตัวเลือก", "Remove option")}</button>
                            )}
                        </span>
                    </div>
                    <input
                        className="input"
                        aria-label={L("ชื่อตัวเลือก", "Option name")}
                        placeholder={L("เช่น เปลี่ยน SSD 512GB และย้ายข้อมูล", "e.g. Replace with a 512GB SSD and move data")}
                        value={o.title}
                        onChange={(e) => update(index, { title: e.target.value })}
                    />
                    <textarea
                        className="input"
                        rows={2}
                        aria-label={L("อธิบายให้ลูกค้าเข้าใจ", "Explain it for the customer")}
                        placeholder={L("อธิบายให้ลูกค้าเข้าใจ เช่น เร็วขึ้น ข้อมูลเดิมอยู่ครบ รับประกัน 90 วัน", "In plain words, e.g. faster, keeps all your files, 90-day warranty")}
                        value={o.description}
                        onChange={(e) => update(index, { description: e.target.value })}
                    />
                    <ItemsEditor items={o.items} onChange={(items) => update(index, { items })} parts={parts} withPrice />
                </section>
            ))}
            <div className="cluster" style={{ justifyContent: "space-between" }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={options.length >= MAX_OPTIONS} onClick={() => onChange([...options, blankOption()])}>
                    + {L("เพิ่มตัวเลือก", "Add an option")}
                </button>
                <span className="small muted">
                    {additional
                        ? L("ระบบจะเพิ่มตัวเลือก “ไม่ทำงานเพิ่ม” ให้ลูกค้าเอง", "The system adds “skip the extra work” for the customer.")
                        : L("ระบบจะเพิ่มตัวเลือก “ไม่ซ่อม” (ค่าตรวจเช็ก) ให้ลูกค้าเอง", "The system adds “no repair” (the inspection fee) for the customer.")}
                </span>
            </div>
        </div>
    );
}

export function optionsValid(options) {
    return options.length > 0 && options.every((o) =>
        o.title.trim() && itemsValid(o.items, true) && totalOf(o.items) > 0
    );
}

export function optionsPayload(options) {
    return options.map((o) => ({
        title: o.title.trim(),
        description: o.description.trim() || null,
        items: toPayload(o.items).map(({ item_id: _id, ...item }) => item)
    }));
}
