import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, Stamp, TextField, useAction } from "../../components/ui.jsx";

export default function BookingDetail() {
    const { bookingId } = useParams();
    const { L, t, fmt } = useI18n();
    const booking = useAsync(() => api.bookings.get(bookingId), [bookingId]);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [run, busy] = useAction();

    async function cancel() {
        await run(() => api.bookings.cancel(bookingId, reason), L("ยกเลิกการจองแล้ว", "Booking cancelled")).catch(() => null);
        setCancelOpen(false);
        booking.reload();
    }

    if (booking.loading && !booking.data) return <Loading />;
    if (booking.error) return <ErrorNotice error={booking.error} onRetry={booking.reload} />;
    const b = booking.data;
    const canCancel = ["PENDING", "CONFIRMED"].includes(b.status) && new Date(b.scheduled_at) > new Date();

    return (
        <div className="stack-lg" style={{ maxWidth: 820 }}>
            <Link to="/my/bookings" className="small">← {L("การจองของฉัน", "My bookings")}</Link>
            <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                    <p className="faint small">{L("เลขที่จอง", "Booking")}</p>
                    <h1 className="num">{b.booking_number}</h1>
                </div>
                <Stamp kind="booking" status={b.status} />
            </div>

            {b.status === "PENDING" && <div className="notice warn">{L("รอร้านยืนยันคิว ปกติภายใน 1 ชั่วโมงในเวลาทำการ", "Waiting for the shop to confirm — usually within an hour during opening hours.")}</div>}
            {b.status === "CONFIRMED" && <div className="notice ok">{L("ยืนยันคิวแล้ว นำเครื่องและอุปกรณ์ชาร์จมาตามเวลานัด", "Confirmed. Bring the device and its charger at your appointment time.")}</div>}
            {b.status === "COMPLETED" && b.work_order_id && (
                <div className="notice ok">
                    <span>{L("ร้านรับเครื่องแล้ว ", "We've received your device. ")}<Link to={`/my/repairs/${b.work_order_id}`}>{L("ติดตามงานซ่อม", "Track the repair")}</Link></span>
                </div>
            )}
            {b.status === "CANCELLED" && <div className="notice error">{L("ยกเลิกแล้ว", "Cancelled")}{b.cancellation_reason ? ` — ${b.cancellation_reason}` : ""}</div>}

            <section className="panel">
                <dl className="facts">
                    <dt>{L("บริการ", "Service")}</dt>
                    <dd>{b.service_name} · {L("เริ่ม", "from")} <Money value={b.service_starting_price} /></dd>
                    <dt>{L("วันเวลานัด", "Appointment")}</dt>
                    <dd>{fmt.dateLong(b.scheduled_at)} · {b.appointment_time}</dd>
                    <dt>{L("เครื่อง", "Device")}</dt>
                    <dd>{[b.device_type, b.brand, b.model].filter(Boolean).join(" · ")}</dd>
                    {b.serial_number && (<><dt>Serial</dt><dd>{b.serial_number}</dd></>)}
                    <dt>{L("อาการ", "Symptom")}</dt>
                    <dd>{b.reported_symptom}</dd>
                </dl>
            </section>

            <section>
                <h2 style={{ marginBottom: 12 }}>{L("ประวัติสถานะ", "Status history")}</h2>
                <ol className="timeline">
                    {b.status_history.map((h) => (
                        <li key={h.history_id}>
                            <strong>{t(`status.booking.${h.new_status}`)}</strong>
                            <div className="faint small">{fmt.dateTime(h.created_at)} · {h.changed_by_name}{h.reason ? ` · ${h.reason}` : ""}</div>
                        </li>
                    ))}
                </ol>
            </section>

            {canCancel && (
                <div>
                    <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)}>{L("ยกเลิกการจอง", "Cancel booking")}</button>
                </div>
            )}

            {cancelOpen && (
                <Modal
                    title={L("ยกเลิกการจองนี้?", "Cancel this booking?")}
                    onClose={() => setCancelOpen(false)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(false)}>{L("ไม่ยกเลิก", "Keep booking")}</button>
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={cancel}>{L("ยกเลิกการจอง", "Cancel booking")}</button>
                        </>
                    )}
                >
                    <div className="stack">
                        <p className="muted small">{L("คิวนี้จะถูกปล่อยให้คนอื่นจอง และเปิดกลับไม่ได้", "The slot will be released and can't be restored.")}</p>
                        <TextField as="textarea" label={L("เหตุผล (ไม่บังคับ)", "Reason (optional)")} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                </Modal>
            )}
        </div>
    );
}
