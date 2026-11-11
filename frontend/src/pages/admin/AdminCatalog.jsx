import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, PageHead, TextField, useAction } from "../../components/ui.jsx";
import "./admin.css";

const EMPTY_SERVICE = { service_code: "", service_name: "", category_id: "", starting_price: "", estimated_duration_minutes: "", description: "" };
const EMPTY_CATEGORY = { category_code: "", category_name: "", description: "" };

export default function AdminCatalog() {
    const { L, t } = useI18n();
    const [tab, setTab] = useState("services");
    const data = useAsync(async () => {
        const [categories, services] = await Promise.all([
            api.catalog.listCategories({ includeInactive: true }),
            api.catalog.listServices({ includeInactive: true })
        ]);
        return { categories, services };
    }, []);
    const [run, busy] = useAction();
    const [editing, setEditing] = useState(null); // { type, id?, form }

    async function save() {
        const { type, id, form } = editing;
        const call = type === "service"
            ? (id ? () => api.catalog.updateService(id, { service_name: form.service_name, category_id: form.category_id, starting_price: form.starting_price, estimated_duration_minutes: form.estimated_duration_minutes, description: form.description }) : () => api.catalog.createService(form))
            : (id ? () => api.catalog.updateCategory(id, { category_name: form.category_name, description: form.description }) : () => api.catalog.createCategory(form));
        const ok = await run(call, L("บันทึกแล้ว", "Saved")).catch(() => null);
        if (ok) {
            setEditing(null);
            data.reload();
        }
    }

    async function toggle(type, item) {
        const call = type === "service" ? () => api.catalog.setServiceStatus(item.service_id, !item.is_active) : () => api.catalog.setCategoryStatus(item.category_id, !item.is_active);
        await run(call, item.is_active ? L("ปิดแล้ว ลูกค้าจะไม่เห็น", "Hidden from customers") : L("เปิดให้จองแล้ว", "Now bookable")).catch(() => null);
        data.reload();
    }

    const f = editing?.form;
    const set = (k) => (e) => setEditing((x) => ({ ...x, form: { ...x.form, [k]: e.target.value } }));

    return (
        <div>
            <PageHead
                title={L("บริการและราคา", "Services & prices")}
                lede={L("ปิดบริการแทนการลบ เพราะการจองเก่ายังอ้างถึงอยู่ ทุกการแก้ไขถูกบันทึกใน audit log", "Hide services instead of deleting them — past bookings still refer to them. Every change is audit-logged.")}
                actions={tab === "services"
                    ? <button type="button" className="btn btn-primary" onClick={() => setEditing({ type: "service", form: { ...EMPTY_SERVICE, category_id: data.data?.categories.find((c) => c.is_active)?.category_id || "" } })}>{L("เพิ่มบริการ", "Add service")}</button>
                    : <button type="button" className="btn btn-primary" onClick={() => setEditing({ type: "category", form: { ...EMPTY_CATEGORY } })}>{L("เพิ่มหมวดหมู่", "Add category")}</button>}
            />
            <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
                <button type="button" role="tab" className="tab" aria-selected={tab === "services"} onClick={() => setTab("services")}>{L("บริการ", "Services")}</button>
                <button type="button" role="tab" className="tab" aria-selected={tab === "categories"} onClick={() => setTab("categories")}>{L("หมวดหมู่", "Categories")}</button>
            </div>
            {data.loading && !data.data && <Loading />}
            <ErrorNotice error={data.error} onRetry={data.reload} />

            {data.data && tab === "services" && (
                <div className="table-wrap">
                    <table className="table">
                        <thead><tr><th>{L("รหัส", "Code")}</th><th>{L("บริการ", "Service")}</th><th>{L("หมวด", "Category")}</th><th className="right">{L("ราคาเริ่มต้น", "From")}</th><th className="right">{L("นาที", "Min")}</th><th>{L("สถานะ", "Status")}</th><th /></tr></thead>
                        <tbody>
                            {data.data.services.map((s) => (
                                <tr key={s.service_id}>
                                    <td className="num faint">{s.service_code}</td>
                                    <td>{s.service_name}</td>
                                    <td>{s.category_name}{!s.category_is_active && <span className="faint small"> ({L("หมวดถูกปิด", "category hidden")})</span>}</td>
                                    <td className="right"><Money value={s.starting_price} /></td>
                                    <td className="right num">{s.estimated_duration_minutes}</td>
                                    <td>{s.is_active ? <span className="badge tone-green">{L("เปิดจอง", "Bookable")}</span> : <span className="badge tone-grey">{L("ปิด", "Hidden")}</span>}</td>
                                    <td className="right">
                                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing({ type: "service", id: s.service_id, form: { ...s, description: s.description || "" } })}>{L("แก้ไข", "Edit")}</button>
                                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle("service", s)}>{s.is_active ? L("ปิด", "Hide") : L("เปิด", "Show")}</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {data.data && tab === "categories" && (
                <div className="table-wrap">
                    <table className="table">
                        <thead><tr><th>{L("รหัส", "Code")}</th><th>{L("ชื่อหมวด", "Name")}</th><th>{L("คำอธิบาย", "Description")}</th><th className="right">{L("บริการ", "Services")}</th><th>{L("สถานะ", "Status")}</th><th /></tr></thead>
                        <tbody>
                            {data.data.categories.map((c) => (
                                <tr key={c.category_id}>
                                    <td className="num faint">{c.category_code}</td>
                                    <td>{c.category_name}</td>
                                    <td className="muted">{c.description}</td>
                                    <td className="right num">{data.data.services.filter((s) => s.category_id === c.category_id).length}</td>
                                    <td>{c.is_active ? <span className="badge tone-green">{L("เปิด", "Visible")}</span> : <span className="badge tone-grey">{L("ปิด", "Hidden")}</span>}</td>
                                    <td className="right">
                                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing({ type: "category", id: c.category_id, form: { ...c, description: c.description || "" } })}>{L("แก้ไข", "Edit")}</button>
                                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle("category", c)}>{c.is_active ? L("ปิด", "Hide") : L("เปิด", "Show")}</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editing && (
                <Modal
                    title={editing.type === "service" ? (editing.id ? L("แก้ไขบริการ", "Edit service") : L("เพิ่มบริการ", "Add service")) : (editing.id ? L("แก้ไขหมวดหมู่", "Edit category") : L("เพิ่มหมวดหมู่", "Add category"))}
                    onClose={() => setEditing(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{t("common.save")}</button>
                        </>
                    )}
                >
                    {editing.type === "service" ? (
                        <div className="form-grid">
                            <div className="form-grid two">
                                <TextField label={L("รหัสบริการ", "Code")} value={f.service_code} onChange={set("service_code")} disabled={Boolean(editing.id)} hint={editing.id ? L("เปลี่ยนรหัสไม่ได้", "Can't be changed") : "A-Z 0-9 - _"} />
                                <TextField as="select" label={L("หมวดหมู่", "Category")} value={f.category_id} onChange={set("category_id")}>
                                    {data.data.categories.filter((c) => c.is_active || c.category_id === f.category_id).map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                                </TextField>
                            </div>
                            <TextField label={L("ชื่อบริการ", "Name")} value={f.service_name} onChange={set("service_name")} />
                            <div className="form-grid two">
                                <TextField type="number" min="0" step="1" label={L("ราคาเริ่มต้น (บาท)", "Starting price (THB)")} value={f.starting_price} onChange={set("starting_price")} hint={L("จำนวนเต็มบาท", "Whole baht")} />
                                <TextField type="number" min="1" step="1" label={L("ระยะเวลา (นาที)", "Duration (min)")} value={f.estimated_duration_minutes} onChange={set("estimated_duration_minutes")} />
                            </div>
                            <TextField as="textarea" label={L("คำอธิบาย", "Description")} value={f.description} onChange={set("description")} />
                        </div>
                    ) : (
                        <div className="form-grid">
                            <TextField label={L("รหัสหมวด", "Code")} value={f.category_code} onChange={set("category_code")} disabled={Boolean(editing.id)} />
                            <TextField label={L("ชื่อหมวด", "Name")} value={f.category_name} onChange={set("category_name")} />
                            <TextField as="textarea" label={L("คำอธิบาย", "Description")} value={f.description} onChange={set("description")} />
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
