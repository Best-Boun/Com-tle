import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { PageHead, TextField, useAction } from "../../components/ui.jsx";

export default function WalkInNew() {
    const { L } = useI18n();
    const navigate = useNavigate();
    const services = useAsync(() => api.catalog.listServices(), []);
    const [run, busy] = useAction();
    const [f, setF] = useState({ customer_name: "", customer_phone: "", service_id: "", device_type: "", brand: "", model: "", serial_number: "", reported_symptom: "", accessories: "" });
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
    const valid = f.customer_name.trim() && f.customer_phone.trim() && f.device_type.trim() && f.reported_symptom.trim();

    async function submit(e) {
        e.preventDefault();
        const wo = await run(() => api.repairs.createWalkIn(f), L("เปิดใบงานแล้ว", "Work order opened")).catch(() => null);
        if (wo) navigate(`/admin/work-orders/${wo.work_order_id}`);
    }

    return (
        <div style={{ maxWidth: 760 }}>
            <Link to="/admin/work-orders" className="small">← {L("ใบงานซ่อม", "Work orders")}</Link>
            <PageHead title={L("รับเครื่อง Walk-in", "New walk-in")} lede={L("ลูกค้าที่มาหน้าร้านโดยไม่ได้จอง", "For customers who arrive without a booking.")} />
            <form className="stack-lg" onSubmit={submit}>
                <fieldset className="panel stack" style={{ margin: 0 }}>
                    <legend className="field-label" style={{ padding: "0 4px" }}>{L("ลูกค้า", "Customer")}</legend>
                    <div className="form-grid two">
                        <TextField label={L("ชื่อลูกค้า", "Name")} value={f.customer_name} onChange={set("customer_name")} required />
                        <TextField label={L("เบอร์โทร", "Phone")} type="tel" value={f.customer_phone} onChange={set("customer_phone")} required />
                    </div>
                </fieldset>
                <fieldset className="panel stack" style={{ margin: 0 }}>
                    <legend className="field-label" style={{ padding: "0 4px" }}>{L("เครื่องที่รับ", "Device")}</legend>
                    <div className="form-grid two">
                        <TextField as="select" label={L("บริการที่ลูกค้าต้องการ", "Requested service")} value={f.service_id} onChange={set("service_id")}>
                            <option value="">{L("ยังไม่ระบุ (ตรวจก่อน)", "Not sure yet (diagnose first)")}</option>
                            {services.data?.map((s) => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
                        </TextField>
                        <TextField as="select" label={L("ประเภทเครื่อง", "Device type")} value={f.device_type} onChange={set("device_type")} required>
                            <option value="">{L("เลือก", "Choose")}</option>
                            <option value="โน้ตบุ๊ก">{L("โน้ตบุ๊ก", "Laptop")}</option>
                            <option value="PC">PC</option>
                            <option value="All-in-One">All-in-One</option>
                            <option value="อื่น ๆ">{L("อื่น ๆ", "Other")}</option>
                        </TextField>
                        <TextField label={L("ยี่ห้อ", "Brand")} value={f.brand} onChange={set("brand")} />
                        <TextField label={L("รุ่น", "Model")} value={f.model} onChange={set("model")} />
                        <TextField label="Serial number" value={f.serial_number} onChange={set("serial_number")} />
                        <TextField label={L("อุปกรณ์ที่ฝาก", "Accessories")} value={f.accessories} onChange={set("accessories")} placeholder={L("เช่น อะแดปเตอร์", "e.g. charger")} />
                    </div>
                    <TextField as="textarea" label={L("อาการที่ลูกค้าแจ้ง", "Reported problem")} value={f.reported_symptom} onChange={set("reported_symptom")} required />
                </fieldset>
                <div className="btn-row">
                    <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !valid}>{L("เปิดใบงาน", "Open work order")}</button>
                    <Link to="/admin/work-orders" className="btn btn-secondary btn-lg">{L("ยกเลิก", "Cancel")}</Link>
                </div>
            </form>
        </div>
    );
}
