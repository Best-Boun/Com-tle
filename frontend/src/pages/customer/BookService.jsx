import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead, TextField, useAction } from "../../components/ui.jsx";
import Ticket from "../../components/Ticket.jsx";
import "./customer.css";

const DEVICE_TYPES = ["NOTEBOOK", "DESKTOP", "ALL_IN_ONE", "OTHER"];

/**
 * "แจ้งซ่อมล่วงหน้า": the customer tells the shop which device and what kind of
 * problem before bringing it in. No time slot: they come in when it suits them,
 * and the counter finds the request by its number or their phone.
 */
export default function BookService() {
    const { L, t } = useI18n();
    const { user } = useAuth();
    const [params] = useSearchParams();
    const [form, setForm] = useState({
        device_type: "",
        brand: "",
        model: "",
        serial_number: "",
        symptom_group: "",
        reported_symptom: "",
        contact_name: user?.full_name || "",
        contact_phone: user?.phone || "",
        service_id: params.get("service") || ""
    });
    const [created, setCreated] = useState(null);
    const [run, busy] = useAction();

    const options = useAsync(() => api.bookings.options(), []);
    const services = useAsync(() => api.catalog.listServices(), []);
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
    const service = services.data?.find((s) => s.service_id === form.service_id);

    const valid = form.device_type && form.symptom_group && form.reported_symptom.trim()
        && form.contact_name.trim() && form.contact_phone.trim();

    async function submit(e) {
        e.preventDefault();
        if (!valid) return;
        const request = await run(
            () => api.bookings.create(form),
            L("ส่งเรื่องแจ้งซ่อมแล้ว", "Repair request sent")
        ).catch(() => null);
        if (request) setCreated(request);
    }

    if (created) {
        return (
            <div className="stack-lg" style={{ maxWidth: 720 }}>
                <PageHead
                    title={L("แจ้งซ่อมเรียบร้อย", "Request sent")}
                    lede={L(
                        "นำเครื่องมาที่ร้านได้เลยในเวลาทำการ ไม่ต้องนัดเวลา แจ้งเลขนี้หรือเบอร์โทรที่หน้าร้าน ร้านตรวจเช็กให้ฟรี ถ้าตรวจแล้วไม่ซ่อมมีค่าตรวจ ฿300",
                        "Bring the device in any time we're open, no appointment needed. Give this number or your phone at the counter. Checking is free; if you decide not to repair, there is a ฿300 inspection fee."
                    )}
                />
                <Ticket
                    to={`/my/bookings/${created.booking_id}`}
                    number={created.booking_number}
                    title={t(`symptom.${created.symptom_group}`)}
                    meta={[t(`device.${created.device_type}`), [created.brand, created.model].filter(Boolean).join(" ")]}
                    kind="booking"
                    status={created.status}
                />
                <div className="btn-row">
                    <Link to="/my/bookings" className="btn btn-primary">{L("ไปที่การแจ้งซ่อมของฉัน", "Go to my requests")}</Link>
                    <Link to="/" className="btn btn-secondary">{L("กลับหน้าแรก", "Back to home")}</Link>
                </div>
            </div>
        );
    }

    const symptomGroups = options.data?.symptom_groups || [];

    return (
        <div className="booking-flow">
            <PageHead
                title={L("แจ้งซ่อมล่วงหน้า", "Tell us before you come in")}
                lede={L(
                    "บอกเราว่าเครื่องเป็นอะไร แล้วนำเครื่องมาที่ร้านเมื่อสะดวก ไม่ต้องเลือกวันเวลา ไม่ต้องจ่ายมัดจำ",
                    "Tell us what's wrong, then bring the device in when it suits you. No time slot, no deposit."
                )}
            />
            {options.loading && <Loading />}
            <ErrorNotice error={options.error} onRetry={options.reload} />

            <form className="stack-lg" style={{ maxWidth: 720 }} onSubmit={submit}>
                <section className="stack">
                    <h2 className="flow-h">{L("1. เครื่องของคุณ", "1. Your device")}</h2>
                    <div className="form-grid two">
                        <TextField as="select" label={L("ประเภทเครื่อง", "Device type")} value={form.device_type} onChange={set("device_type")} required>
                            <option value="">{L("เลือก", "Choose")}</option>
                            {DEVICE_TYPES.map((d) => <option key={d} value={d}>{t(`device.${d}`)}</option>)}
                        </TextField>
                        <TextField label={L("ยี่ห้อ", "Brand")} value={form.brand} onChange={set("brand")} placeholder="Asus, Lenovo, HP…" />
                        <TextField label={L("รุ่น", "Model")} value={form.model} onChange={set("model")} />
                        <TextField label={L("Serial number (ถ้ามี)", "Serial number (optional)")} value={form.serial_number} onChange={set("serial_number")} hint={L("ดูได้จากสติกเกอร์ใต้เครื่อง", "Usually on a sticker under the device")} />
                    </div>
                </section>

                <section className="stack">
                    <h2 className="flow-h">{L("2. อาการที่พบ", "2. What's wrong?")}</h2>
                    <div className="choice-list" role="radiogroup" aria-label={L("กลุ่มอาการ", "Kind of problem")}>
                        {symptomGroups.map((g) => (
                            <label key={g} className={`choice ${form.symptom_group === g ? "selected" : ""}`}>
                                <input type="radio" name="symptom_group" value={g} checked={form.symptom_group === g} onChange={set("symptom_group")} />
                                <span className="choice-main"><strong>{t(`symptom.${g}`)}</strong></span>
                            </label>
                        ))}
                    </div>
                    <TextField
                        as="textarea"
                        label={L("เล่าอาการเพิ่มเติม", "Tell us more")}
                        value={form.reported_symptom}
                        onChange={set("reported_symptom")}
                        required
                        placeholder={L("เช่น เปิดไม่ติด ไฟชาร์จติดแต่จอดำ เป็นมา 2 วัน เคยตกหรือโดนน้ำไหม", "e.g. won't turn on, charging light is on but the screen stays black, for 2 days; was it dropped or wet?")}
                    />
                    {services.data && (
                        <TextField
                            as="select"
                            label={L("รู้แล้วว่าต้องการบริการไหน (ไม่บังคับ)", "Already know the service you need? (optional)")}
                            hint={L("ถ้าไม่แน่ใจ ไม่ต้องเลือก ร้านจะตรวจเช็กอาการก่อนแล้วเสนอราคา", "Not sure? Leave it — we'll check the device first and give you options with prices.")}
                            value={form.service_id}
                            onChange={set("service_id")}
                        >
                            <option value="">{L("ไม่แน่ใจ ให้ร้านตรวจเช็กก่อน", "Not sure — check it first")}</option>
                            {services.data.map((s) => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
                        </TextField>
                    )}
                    {service && <p className="small muted">{service.service_name} · {L("เริ่ม", "from")} <Money value={service.starting_price} /></p>}
                </section>

                <section className="stack">
                    <h2 className="flow-h">{L("3. ติดต่อกลับ", "3. How to reach you")}</h2>
                    <div className="form-grid two">
                        <TextField label={L("ชื่อผู้ติดต่อ", "Contact name")} value={form.contact_name} onChange={set("contact_name")} required />
                        <TextField
                            label={L("เบอร์โทร", "Phone")}
                            type="tel"
                            inputMode="tel"
                            value={form.contact_phone}
                            onChange={set("contact_phone")}
                            required
                            placeholder="081-234-5678"
                            hint={L("หน้าร้านใช้เบอร์นี้ค้นหาคำขอของคุณ", "The counter finds your request with this number")}
                        />
                    </div>
                </section>

                <div className="notice info">
                    {L(
                        "ร้านตรวจเช็กให้ฟรี แล้วเสนอทางเลือกพร้อมราคาให้คุณเลือก ถ้าเลือกไม่ซ่อมมีค่าตรวจ ฿300 ร้านไม่เริ่มซ่อมจนกว่าคุณเลือก",
                        "Checking is free. We'll then give you options with prices to choose from; choosing not to repair costs a ฿300 inspection fee. Nothing is repaired until you choose."
                    )}
                </div>
                <div className="btn-row">
                    <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !valid}>
                        {busy ? L("กำลังส่ง…", "Sending…") : L("ส่งเรื่องแจ้งซ่อม", "Send request")}
                    </button>
                </div>
            </form>
        </div>
    );
}
