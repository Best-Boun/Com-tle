import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, Stamp, TextField, useAction } from "../../components/ui.jsx";
import { deviceLine, symptomLabel } from "../../utils/requestLabels.js";

export default function BookingDetail() {
    const { bookingId } = useParams();
    const { L, t, fmt } = useI18n();
    const booking = useAsync(() => api.bookings.get(bookingId), [bookingId]);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [run, busy] = useAction();

    async function cancel() {
        await run(() => api.bookings.cancel(bookingId, reason), L("ยกเลิกคำขอแล้ว", "Request cancelled")).catch(() => null);
        setCancelOpen(false);
        booking.reload();
    }

    if (booking.loading && !booking.data) return <Loading />;
    if (booking.error) return <ErrorNotice error={booking.error} onRetry={booking.reload} />;
    const b = booking.data;
    const canCancel = ["PENDING", "CONFIRMED"].includes(b.status);

    return (
        <div className="stack-lg" style={{ maxWidth: 820 }}>
            <Link to="/my/bookings" className="small">← {L("การแจ้งซ่อมของฉัน", "My repair requests")}</Link>
            <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                    <p className="faint small">{L("เลขที่คำขอ", "Request")}</p>
                    <h1 className="num">{b.booking_number}</h1>
                </div>
                <Stamp kind="booking" status={b.status} />
            </div>

            {b.status === "PENDING" && <div className="notice info">{L(`นำเครื่องและอุปกรณ์ชาร์จมาที่ร้านได้เลยในเวลาทำการ ไม่ต้องนัด แจ้งเลข ${b.booking_number} หรือเบอร์ ${b.contact_phone || ""} ที่หน้าร้าน`, `Bring the device and its charger in any time we're open. Give ${b.booking_number} or your phone at the counter.`)}</div>}
            {b.status === "CONFIRMED" && <div className="notice ok">{L("นัดจากระบบเดิม นำเครื่องและอุปกรณ์ชาร์จมาที่ร้านได้เลย", "An appointment from the old system. Bring the device and its charger in.")}</div>}
            {b.status === "EXPIRED" && <div className="notice warn">{L("คำขอนี้ปิดอัตโนมัติเพราะไม่ได้นำเครื่องมาภายใน 30 วัน แจ้งซ่อมใหม่ได้เลย", "This request closed itself because no device came in within 30 days. Send a new one any time.")}</div>}
            {b.status === "COMPLETED" && b.work_order_id && (
                <div className="notice ok">
                    <span>{L("ร้านรับเครื่องแล้ว ", "We've received your device. ")}<Link to={`/my/repairs/${b.work_order_id}`}>{L("ติดตามงานซ่อม", "Track the repair")}</Link></span>
                </div>
            )}
            {b.status === "NO_SHOW" && <div className="notice error">{L("ร้านบันทึกว่าคุณไม่ได้มาตามนัดนี้ (ระบบเดิม) แจ้งซ่อมใหม่ได้เลย", "The shop recorded that you missed this appointment (old system). Send a new request any time.")}</div>}
            {b.status === "CANCELLED" && <div className="notice error">{L("ยกเลิกแล้ว", "Cancelled")}{b.cancellation_reason ? ` — ${b.cancellation_reason}` : ""}</div>}

            <section className="panel">
                <dl className="facts">
                    <dt>{L("เครื่อง", "Device")}</dt>
                    <dd>{deviceLine(t, b)}</dd>
                    {b.symptom_group && (<><dt>{L("กลุ่มอาการ", "Kind of problem")}</dt><dd>{symptomLabel(t, b.symptom_group)}</dd></>)}
                    {b.serial_number && (<><dt>Serial</dt><dd>{b.serial_number}</dd></>)}
                    <dt>{L("อาการ", "Symptom")}</dt>
                    <dd>{b.reported_symptom}</dd>
                    <dt>{L("บริการ", "Service")}</dt>
                    <dd>{b.service_name} · {L("เริ่ม", "from")} <Money value={b.service_starting_price} /></dd>
                    {b.contact_phone && (<><dt>{L("ติดต่อ", "Contact")}</dt><dd>{b.contact_name} · <span className="num">{b.contact_phone}</span></dd></>)}
                    {b.scheduled_at
                        ? (<><dt>{L("วันเวลานัด (ระบบเดิม)", "Appointment (old system)")}</dt><dd>{fmt.dateLong(b.scheduled_at)} · {b.appointment_time}</dd></>)
                        : (<><dt>{L("แจ้งเมื่อ", "Sent")}</dt><dd>{fmt.dateTime(b.created_at)}</dd></>)}
                </dl>
            </section>

            <section>
                <h2 style={{ marginBottom: 12 }}>{L("ประวัติสถานะ", "Status history")}</h2>
                <ol className="timeline">
                    {b.status_history.map((h) => (
                        <li key={h.history_id}>
                            <strong>{t(`status.booking.${h.new_status}`)}</strong>
                            <div className="faint small">{fmt.dateTime(h.created_at)} · {h.changed_by_name || L("ระบบ", "System")}{h.reason ? ` · ${h.reason}` : ""}</div>
                        </li>
                    ))}
                </ol>
            </section>

            {canCancel && (
                <div>
                    <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)}>{L("ยกเลิกคำขอ", "Cancel request")}</button>
                </div>
            )}

            {cancelOpen && (
                <Modal
                    title={L("ยกเลิกคำขอนี้?", "Cancel this request?")}
                    onClose={() => setCancelOpen(false)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(false)}>{L("ไม่ยกเลิก", "Keep it")}</button>
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={cancel}>{L("ยกเลิกคำขอ", "Cancel request")}</button>
                        </>
                    )}
                >
                    <div className="stack">
                        <p className="muted small">{L("ยกเลิกแล้วเปิดกลับไม่ได้ ถ้ายังต้องการซ่อม แจ้งซ่อมใหม่หรือเดินเข้าร้านได้เลย", "This can't be undone. You can always send a new request or just walk in.")}</p>
                        <TextField as="textarea" label={L("เหตุผล (ไม่บังคับ)", "Reason (optional)")} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                </Modal>
            )}
        </div>
    );
}
