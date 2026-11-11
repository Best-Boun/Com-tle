import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead, TextField, useAction } from "../../components/ui.jsx";
import Ticket from "../../components/Ticket.jsx";
import "./customer.css";

function bangkokToday() {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(ymd, n) {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const STEPS = [
    { th: "เลือกบริการ", en: "Service" },
    { th: "วันและเวลา", en: "Date & time" },
    { th: "ข้อมูลเครื่อง", en: "Your device" },
    { th: "ตรวจสอบและยืนยัน", en: "Review" }
];

export default function BookService() {
    const { L, fmt } = useI18n();
    const [params] = useSearchParams();
    const [step, setStep] = useState(0);
    const [serviceId, setServiceId] = useState(params.get("service") || "");
    const [date, setDate] = useState(bangkokToday());
    const [time, setTime] = useState("");
    const [device, setDevice] = useState({ device_type: "", brand: "", model: "", serial_number: "", reported_symptom: "" });
    const [created, setCreated] = useState(null);
    const [run, busy] = useAction();

    const services = useAsync(() => api.catalog.listServices(), []);
    const availability = useAsync(() => api.bookings.availability(date), [date]);
    const service = services.data?.find((s) => s.service_id === serviceId);

    useEffect(() => {
        if (params.get("service") && services.data?.some((s) => s.service_id === params.get("service"))) setStep(1);
    }, [params, services.data]);

    useEffect(() => setTime(""), [date]);

    const days = useMemo(() => {
        const today = bangkokToday();
        return Array.from({ length: 14 }, (_, i) => addDays(today, i));
    }, []);

    const deviceValid = device.device_type.trim() && device.reported_symptom.trim();
    const setD = (key) => (e) => setDevice((d) => ({ ...d, [key]: e.target.value }));

    async function confirm() {
        const booking = await run(
            () => api.bookings.create({ service_id: serviceId, appointment_date: date, appointment_time: time, ...device }),
            L("จองคิวเรียบร้อย", "Booking sent")
        ).catch(() => null);
        if (booking) setCreated(booking);
    }

    if (created) {
        return (
            <div className="stack-lg" style={{ maxWidth: 720 }}>
                <PageHead title={L("ส่งคำขอจองแล้ว", "Booking sent")} lede={L("ร้านจะยืนยันคิวให้เร็วที่สุด คุณดูสถานะได้ที่หน้าการจองของฉัน", "The shop will confirm soon. You can follow it under My bookings.")} />
                <Ticket
                    to={`/my/bookings/${created.booking_id}`}
                    number={created.booking_number}
                    title={created.service_name}
                    meta={[fmt.dateLong(created.scheduled_at), `${created.appointment_time} ${L("น.", "")}`.trim()]}
                    kind="booking"
                    status={created.status}
                />
                <div className="btn-row">
                    <Link to="/my/bookings" className="btn btn-primary">{L("ไปที่การจองของฉัน", "Go to my bookings")}</Link>
                    <Link to="/" className="btn btn-secondary">{L("กลับหน้าแรก", "Back to home")}</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="booking-flow">
            <PageHead title={L("จองคิวซ่อม", "Book a repair")} />

            <ol className="flow-steps" aria-label={L("ขั้นตอนการจอง", "Booking steps")}>
                {STEPS.map((s, i) => (
                    <li key={s.en} className={i < step ? "done" : i === step ? "current" : ""} aria-current={i === step ? "step" : undefined}>
                        <span className="flow-num num">{i + 1}</span>
                        <span>{L(s.th, s.en)}</span>
                    </li>
                ))}
            </ol>

            {step === 0 && (
                <section className="stack">
                    {services.loading && <Loading />}
                    <ErrorNotice error={services.error} onRetry={services.reload} />
                    <div className="choice-list" role="radiogroup" aria-label={L("บริการ", "Service")}>
                        {services.data?.map((s) => (
                            <label key={s.service_id} className={`choice ${serviceId === s.service_id ? "selected" : ""}`}>
                                <input type="radio" name="service" value={s.service_id} checked={serviceId === s.service_id} onChange={() => setServiceId(s.service_id)} />
                                <span className="choice-main">
                                    <strong>{s.service_name}</strong>
                                    <span className="small muted">{s.category_name} · {L("ประมาณ", "about")} {s.estimated_duration_minutes} {L("นาที", "min")}</span>
                                </span>
                                <span className="num choice-price">{L("เริ่ม", "from")} <Money value={s.starting_price} /></span>
                            </label>
                        ))}
                    </div>
                    <div className="btn-row">
                        <button type="button" className="btn btn-primary btn-lg" disabled={!serviceId} onClick={() => setStep(1)}>{L("ถัดไป: เลือกเวลา", "Next: pick a time")}</button>
                    </div>
                </section>
            )}

            {step === 1 && (
                <section className="stack">
                    <div>
                        <h2 className="flow-h">{L("เลือกวัน", "Pick a day")}</h2>
                        <div className="day-strip" role="radiogroup" aria-label={L("วัน", "Day")}>
                            {days.map((d) => (
                                <button key={d} type="button" role="radio" aria-checked={date === d} className={`day ${date === d ? "selected" : ""}`} onClick={() => setDate(d)}>
                                    <span className="small">{fmt.day(d, { weekday: "short" })}</span>
                                    <strong className="num">{fmt.day(d, { day: "numeric" })}</strong>
                                    <span className="small">{fmt.day(d, { month: "short" })}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h2 className="flow-h">{L("เลือกเวลา", "Pick a time")}</h2>
                        {availability.loading && <Loading />}
                        <ErrorNotice error={availability.error} onRetry={availability.reload} />
                        {availability.data && (
                            <div className="slot-grid" role="radiogroup" aria-label={L("เวลา", "Time")}>
                                {availability.data.slots.map((s) => (
                                    <button
                                        key={s.time}
                                        type="button"
                                        role="radio"
                                        aria-checked={time === s.time}
                                        className={`slot ${time === s.time ? "selected" : ""}`}
                                        disabled={!s.available}
                                        onClick={() => setTime(s.time)}
                                    >
                                        <strong className="num">{s.time}</strong>
                                        <span className="small">
                                            {s.available ? L(`ว่าง ${s.remaining} คิว`, `${s.remaining} left`) : s.booked >= s.capacity ? L("เต็ม", "Full") : L("ผ่านไปแล้ว", "Passed")}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="btn-row">
                        <button type="button" className="btn btn-secondary btn-lg" onClick={() => setStep(0)}>{L("ย้อนกลับ", "Back")}</button>
                        <button type="button" className="btn btn-primary btn-lg" disabled={!time} onClick={() => setStep(2)}>{L("ถัดไป: ข้อมูลเครื่อง", "Next: your device")}</button>
                    </div>
                </section>
            )}

            {step === 2 && (
                <form className="stack" style={{ maxWidth: 640 }} onSubmit={(e) => { e.preventDefault(); if (deviceValid) setStep(3); }}>
                    <div className="form-grid two">
                        <TextField as="select" label={L("ประเภทเครื่อง", "Device type")} value={device.device_type} onChange={setD("device_type")} required>
                            <option value="">{L("เลือก", "Choose")}</option>
                            <option value="โน้ตบุ๊ก">{L("โน้ตบุ๊ก", "Laptop")}</option>
                            <option value="PC">{L("คอมพิวเตอร์ตั้งโต๊ะ (PC)", "Desktop PC")}</option>
                            <option value="All-in-One">All-in-One</option>
                            <option value="อื่น ๆ">{L("อื่น ๆ", "Other")}</option>
                        </TextField>
                        <TextField label={L("ยี่ห้อ", "Brand")} value={device.brand} onChange={setD("brand")} placeholder="Asus, Lenovo, HP…" />
                        <TextField label={L("รุ่น", "Model")} value={device.model} onChange={setD("model")} />
                        <TextField label={L("Serial number (ถ้ามี)", "Serial number (optional)")} value={device.serial_number} onChange={setD("serial_number")} hint={L("ดูได้จากสติกเกอร์ใต้เครื่อง", "Usually on a sticker under the device")} />
                    </div>
                    <TextField as="textarea" label={L("อาการที่พบ", "What's wrong?")} value={device.reported_symptom} onChange={setD("reported_symptom")} required placeholder={L("เช่น เปิดไม่ติด ไฟชาร์จติดแต่จอดำ เป็นมา 2 วัน", "e.g. won't turn on, charging light is on but the screen stays black")} />
                    <div className="btn-row">
                        <button type="button" className="btn btn-secondary btn-lg" onClick={() => setStep(1)}>{L("ย้อนกลับ", "Back")}</button>
                        <button type="submit" className="btn btn-primary btn-lg" disabled={!deviceValid}>{L("ถัดไป: ตรวจสอบ", "Next: review")}</button>
                    </div>
                </form>
            )}

            {step === 3 && service && (
                <section className="stack" style={{ maxWidth: 640 }}>
                    <div className="panel">
                        <dl className="facts">
                            <dt>{L("บริการ", "Service")}</dt>
                            <dd>{service.service_name}</dd>
                            <dt>{L("ราคาเริ่มต้น", "Starting price")}</dt>
                            <dd><Money value={service.starting_price} /></dd>
                            <dt>{L("วันเวลานัด", "Appointment")}</dt>
                            <dd>{fmt.day(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {time} {L("น.", "")}</dd>
                            <dt>{L("เครื่อง", "Device")}</dt>
                            <dd>{[device.device_type, device.brand, device.model].filter(Boolean).join(" · ")}</dd>
                            {device.serial_number && (<><dt>Serial</dt><dd>{device.serial_number}</dd></>)}
                            <dt>{L("อาการ", "Symptom")}</dt>
                            <dd>{device.reported_symptom}</dd>
                        </dl>
                    </div>
                    <div className="notice info">
                        {L("ราคาจริงจะแจ้งในใบเสนอราคาหลังช่างตรวจเครื่อง ร้านจะไม่เริ่มซ่อมจนกว่าคุณกดอนุมัติ ยกเลิกการจองได้ก่อนถึงเวลานัด", "You'll get a quotation after we check the device, and we won't start until you approve it. You can cancel before your appointment.")}
                    </div>
                    <div className="btn-row">
                        <button type="button" className="btn btn-secondary btn-lg" onClick={() => setStep(2)}>{L("ย้อนกลับ", "Back")}</button>
                        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={confirm}>{busy ? L("กำลังจอง…", "Booking…") : L("ยืนยันการจอง", "Confirm booking")}</button>
                    </div>
                </section>
            )}
        </div>
    );
}
