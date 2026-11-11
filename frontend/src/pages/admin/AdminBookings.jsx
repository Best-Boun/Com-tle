import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, PageHead, StatusBadge, TextField, useAction } from "../../components/ui.jsx";
import "./admin.css";

export default function AdminBookings() {
    const { L, t, fmt } = useI18n();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const status = params.get("status") || "";
    const date = params.get("date") || "";
    const list = useAsync(() => api.bookings.listAll({ status, date }), [status, date]);
    const [run, busy] = useAction();
    const [cancelling, setCancelling] = useState(null);
    const [checkingIn, setCheckingIn] = useState(null);
    const [text, setText] = useState("");

    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        setParams(next, { replace: true });
    };

    async function confirm(b) {
        await run(() => api.bookings.confirm(b.booking_id), L(`ยืนยัน ${b.booking_number} แล้ว`, `Confirmed ${b.booking_number}`)).catch(() => null);
        list.reload();
    }

    async function cancel() {
        const ok = await run(() => api.bookings.cancel(cancelling.booking_id, text), L("ยกเลิกการจองแล้ว", "Booking cancelled")).catch(() => null);
        if (ok) {
            setCancelling(null);
            setText("");
            list.reload();
        }
    }

    async function checkIn() {
        const result = await run(() => api.bookings.checkIn(checkingIn.booking_id, { accessories: text }), L("รับเครื่องและเปิดใบงานแล้ว", "Device received, work order opened")).catch(() => null);
        if (result) navigate(`/admin/work-orders/${result.work_order.work_order_id}`);
    }

    return (
        <div>
            <PageHead title={L("การจอง", "Bookings")} lede={L("ยืนยันคิว รับเครื่องเมื่อลูกค้ามาถึง (จะเปิดใบงานซ่อมให้อัตโนมัติ)", "Confirm bookings, and check devices in when customers arrive — this opens the work order.")} />
            <div className="filters">
                <TextField as="select" label={L("สถานะ", "Status")} value={status} onChange={(e) => setFilter("status", e.target.value)}>
                    <option value="">{t("common.all")}</option>
                    {["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{t(`status.booking.${s}`)}</option>)}
                </TextField>
                <TextField type="date" label={L("วันนัด", "Date")} value={date} onChange={(e) => setFilter("date", e.target.value)} />
                {(status || date) && <button type="button" className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>{L("ล้างตัวกรอง", "Clear filters")}</button>}
            </div>
            {list.loading && !list.data && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data && (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{L("นัด", "Appointment")}</th>
                                <th>{L("เลขที่จอง", "Booking")}</th>
                                <th>{L("ลูกค้า", "Customer")}</th>
                                <th>{L("บริการ / เครื่อง", "Service / device")}</th>
                                <th>{L("สถานะ", "Status")}</th>
                                <th className="right">{L("ดำเนินการ", "Actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.data.length === 0 && <tr><td colSpan={6} className="muted">{L("ไม่มีการจองตามตัวกรองนี้", "No bookings match these filters.")}</td></tr>}
                            {list.data.map((b) => (
                                <tr key={b.booking_id}>
                                    <td className="num">{fmt.day(b.appointment_date)}<div className="faint small">{b.appointment_time}</div></td>
                                    <td className="num">{b.booking_number}</td>
                                    <td>{b.customer_name}</td>
                                    <td>{b.service_name}<div className="faint small">{[b.device_type, b.brand, b.model].filter(Boolean).join(" · ")} — {b.reported_symptom}</div></td>
                                    <td><StatusBadge kind="booking" status={b.status} /></td>
                                    <td className="right">
                                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                            {b.status === "PENDING" && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => confirm(b)}>{L("ยืนยัน", "Confirm")}</button>}
                                            {b.status === "CONFIRMED" && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setText(""); setCheckingIn(b); }}>{L("รับเครื่อง", "Check in")}</button>}
                                            {["PENDING", "CONFIRMED"].includes(b.status) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(""); setCancelling(b); }}>{t("common.cancel")}</button>}
                                            {b.work_order_id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/admin/work-orders/${b.work_order_id}`)}>{L("ดูใบงาน", "Work order")}</button>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {cancelling && (
                <Modal
                    title={L(`ยกเลิก ${cancelling.booking_number}`, `Cancel ${cancelling.booking_number}`)}
                    onClose={() => setCancelling(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setCancelling(null)}>{L("ไม่ยกเลิก", "Keep booking")}</button>
                            <button type="button" className="btn btn-danger" disabled={busy || !text.trim()} onClick={cancel}>{L("ยกเลิกการจอง", "Cancel booking")}</button>
                        </>
                    )}
                >
                    <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} hint={L("ลูกค้าจะเห็นเหตุผลนี้ ถ้าลูกค้าไม่มาตามนัดให้ระบุที่นี่", "The customer sees this. Use it for no-shows too.")} value={text} onChange={(e) => setText(e.target.value)} />
                </Modal>
            )}

            {checkingIn && (
                <Modal
                    title={L(`รับเครื่อง ${checkingIn.booking_number}`, `Check in ${checkingIn.booking_number}`)}
                    onClose={() => setCheckingIn(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setCheckingIn(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-primary" disabled={busy} onClick={checkIn}>{L("รับเครื่องและเปิดใบงาน", "Check in & open work order")}</button>
                        </>
                    )}
                >
                    <div className="stack">
                        <dl className="facts">
                            <dt>{L("ลูกค้า", "Customer")}</dt><dd>{checkingIn.customer_name}</dd>
                            <dt>{L("เครื่อง", "Device")}</dt><dd>{[checkingIn.device_type, checkingIn.brand, checkingIn.model].filter(Boolean).join(" · ")}</dd>
                            <dt>{L("อาการ", "Symptom")}</dt><dd>{checkingIn.reported_symptom}</dd>
                        </dl>
                        <TextField label={L("อุปกรณ์ที่ลูกค้าฝากไว้", "Accessories left with the device")} placeholder={L("เช่น อะแดปเตอร์ชาร์จ กระเป๋า", "e.g. charger, bag")} value={text} onChange={(e) => setText(e.target.value)} />
                        <p className="small faint">{L("1 การจองเปิดใบงานได้ 1 ใบ", "One booking opens exactly one work order.")}</p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
