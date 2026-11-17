import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, PageHead, StatusBadge, TextField, useAction } from "../../components/ui.jsx";
import { DepositNote } from "../../components/DepositCheckout.jsx";
import "./admin.css";

export default function AdminBookings() {
    const { L, t, fmt } = useI18n();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const status = params.get("status") || "";
    const date = params.get("date") || "";
    const list = useAsync(() => api.bookings.listAll({ status, date }), [status, date]);
    const techs = useAsync(() => api.auth.listTechnicians(), []);
    const deposits = useAsync(() => api.payments.listDeposits().catch(() => []), []);
    const depositOf = (b) => (deposits.data || []).find((d) => d.booking_id === b.booking_id) || null;

    // The deposit follows the booking: refunded on a cancel, kept on a no-show,
    // taken off the repair bill on check-in.
    async function settle(bookingId) {
        await api.payments.settleDeposit(bookingId).catch(() => null);
        deposits.reload();
    }
    const techName = (id) => techs.data?.find((u) => u.user_id === id)?.full_name || L("ช่าง", "Technician");
    const [noShow, setNoShow] = useState(null);
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
            await settle(cancelling.booking_id);
            setCancelling(null);
            setText("");
            list.reload();
        }
    }

    async function markNoShow() {
        const ok = await run(() => api.bookings.markNoShow(noShow.booking_id, text), L("บันทึกว่าลูกค้าไม่มาตามนัดแล้ว", "No-show recorded")).catch(() => null);
        if (ok) {
            await settle(noShow.booking_id);
            setNoShow(null);
            setText("");
            list.reload();
        }
    }

    const isOpen = (b) => ["PENDING", "CONFIRMED"].includes(b.status);
    const timePassed = (b) => new Date(b.scheduled_at).getTime() <= Date.now();

    async function checkIn() {
        const result = await run(() => api.bookings.checkIn(checkingIn.booking_id, { accessories: text }), L("รับเครื่องและเปิดใบงานแล้ว", "Device received, work order opened")).catch(() => null);
        if (result) {
            await settle(checkingIn.booking_id);
            navigate(`/admin/work-orders/${result.work_order.work_order_id}`);
        }
    }

    return (
        <div>
            <PageHead title={L("การจอง", "Bookings")} lede={L("การจองยืนยันเมื่อลูกค้าชำระมัดจำ ฿200 รับเครื่องเมื่อลูกค้ามาถึง (เปิดใบงานให้ช่างที่รับงานไว้) ถ้าเลยเวลานัดแล้วลูกค้าไม่มา กด “ไม่มาตามนัด”", "Bookings confirm once the ฿200 deposit is paid. Check devices in when customers arrive (the work order goes to the technician who took it); mark no-shows once the time has passed.")} />
            <div className="filters">
                <TextField as="select" label={L("สถานะ", "Status")} value={status} onChange={(e) => setFilter("status", e.target.value)}>
                    <option value="">{t("common.all")}</option>
                    {["CONFIRMED", "AWAITING_DEPOSIT", "COMPLETED", "NO_SHOW", "CANCELLED", "PENDING"].map((s) => <option key={s} value={s}>{t(`status.booking.${s}`)}</option>)}
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
                                    <td>
                                        {b.customer_name}
                                        {b.customer_no_show_count > 0 && <div><span className="badge tone-red">{L(`เคยไม่มาตามนัด ${b.customer_no_show_count} ครั้ง`, `${b.customer_no_show_count} past no-show${b.customer_no_show_count > 1 ? "s" : ""}`)}</span></div>}
                                    </td>
                                    <td>{b.service_name}<div className="faint small">{[b.device_type, b.brand, b.model].filter(Boolean).join(" · ")} — {b.reported_symptom}</div></td>
                                    <td>
                                        <StatusBadge kind="booking" status={b.status} />
                                        {depositOf(b) && <div className="faint small"><DepositNote deposit={depositOf(b)} /></div>}
                                        {b.status === "AWAITING_DEPOSIT" && <div className="faint small">{L(`กันคิวถึง ${fmt.time(b.deposit_due_at)} น.`, `Held until ${fmt.time(b.deposit_due_at)}`)}</div>}
                                        {isOpen(b) && <div className="faint small">{b.technician_id ? L(`ช่างที่รับงาน: ${techName(b.technician_id)}`, `Taken by ${techName(b.technician_id)}`) : L("ยังไม่มีช่างรับงาน", "No technician yet")}</div>}
                                        {isOpen(b) && timePassed(b) && <div className="small" style={{ color: "var(--red)" }}>{L("เลยเวลานัดแล้ว", "Time has passed")}</div>}
                                    </td>
                                    <td className="right">
                                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                            {b.status === "PENDING" && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => confirm(b)}>{L("ยืนยัน", "Confirm")}</button>}
                                            {b.status === "CONFIRMED" && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setText(""); setCheckingIn(b); }}>{L("รับเครื่อง", "Check in")}</button>}
                                            {isOpen(b) && timePassed(b) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setText(""); setNoShow(b); }}>{L("ไม่มาตามนัด", "No-show")}</button>}
                                            {(isOpen(b) || b.status === "AWAITING_DEPOSIT") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(""); setCancelling(b); }}>{t("common.cancel")}</button>}
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
                    <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} hint={L("ลูกค้าจะเห็นเหตุผลนี้ ร้านยกเลิกแล้วคืนมัดจำให้ลูกค้าเต็มจำนวน ถ้าลูกค้าไม่มาตามนัด ใช้ปุ่ม “ไม่มาตามนัด” แทน", "The customer sees this, and gets the deposit back in full. For a no-show use the No-show button instead.")} value={text} onChange={(e) => setText(e.target.value)} />
                </Modal>
            )}

            {noShow && (
                <Modal
                    title={L(`ลูกค้าไม่มาตามนัด ${noShow.booking_number}`, `No-show ${noShow.booking_number}`)}
                    onClose={() => setNoShow(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setNoShow(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={markNoShow}>{L("บันทึกว่าไม่มาตามนัด", "Record no-show")}</button>
                        </>
                    )}
                >
                    <div className="stack">
                        <p className="small muted">{L(`นัด ${fmt.day(noShow.appointment_date)} ${noShow.appointment_time} · ${noShow.customer_name} ระบบจะนับเป็นสถิติของลูกค้าคนนี้ ปิดการจอง และร้านเก็บมัดจำไว้`, `Appointment ${fmt.day(noShow.appointment_date)} ${noShow.appointment_time} · ${noShow.customer_name}. This closes the booking, counts against the customer, and the shop keeps the deposit.`)}</p>
                        <TextField as="textarea" label={L("หมายเหตุ (ไม่บังคับ)", "Note (optional)")} placeholder={L("เช่น โทรแล้วไม่รับสาย", "e.g. called, no answer")} value={text} onChange={(e) => setText(e.target.value)} />
                    </div>
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
                        <p className="small faint">
                            {checkingIn.technician_id
                                ? L(`ใบงานจะไปหา ${techName(checkingIn.technician_id)} ที่รับงานนี้ไว้`, `The work order goes to ${techName(checkingIn.technician_id)}, who took this job.`)
                                : L("ยังไม่มีช่างรับงานนี้ มอบหมายช่างได้ในหน้าใบงาน", "No technician took this job yet; assign one on the work order.")}
                            {" · "}{L("1 การจองเปิดใบงานได้ 1 ใบ", "One booking opens exactly one work order.")}
                            {depositOf(checkingIn)?.status === "PAID" && <>{" · "}{L(`มัดจำ ${fmt.money(depositOf(checkingIn).amount)} จะหักจากค่าซ่อมให้อัตโนมัติ`, `The ${fmt.money(depositOf(checkingIn).amount)} deposit comes off the repair bill.`)}</>}
                        </p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
