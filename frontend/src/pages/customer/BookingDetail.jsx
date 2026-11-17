import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Modal, Money, Stamp, TextField, useAction } from "../../components/ui.jsx";
import DepositCheckout, { DepositNote } from "../../components/DepositCheckout.jsx";

const DEPOSIT_TIMEOUT = "Deposit not paid in time";

export default function BookingDetail() {
    const { bookingId } = useParams();
    const { L, t, fmt } = useI18n();
    const booking = useAsync(() => api.bookings.get(bookingId), [bookingId]);
    const deposit = useAsync(() => api.payments.depositFor(bookingId).catch(() => null), [bookingId]);
    const [paying, setPaying] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [run, busy] = useAction();

    async function cancel() {
        const done = await run(() => api.bookings.cancel(bookingId, reason), L("ยกเลิกการจองแล้ว", "Booking cancelled")).catch(() => null);
        // Cancelled before the appointment: the deposit goes back in full.
        if (done) await api.payments.settleDeposit(bookingId).catch(() => null);
        setCancelOpen(false);
        booking.reload();
        deposit.reload();
    }

    if (booking.loading && !booking.data) return <Loading />;
    if (booking.error) return <ErrorNotice error={booking.error} onRetry={booking.reload} />;
    const b = booking.data;
    const canCancel = ["AWAITING_DEPOSIT", "PENDING", "CONFIRMED"].includes(b.status) && new Date(b.scheduled_at) > new Date();
    const holdOpen = b.status === "AWAITING_DEPOSIT" && new Date(b.deposit_due_at) > new Date();
    const reasonText = (text) => (text === DEPOSIT_TIMEOUT ? L("ไม่ได้ชำระมัดจำภายในเวลา", "Deposit not paid in time") : text);
    const dep = deposit.data;

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

            {holdOpen && (
                <div className="notice warn pay-cta" role="status">
                    <span>{L(`กันคิวไว้ให้ถึง ${fmt.time(b.deposit_due_at)} น. ชำระมัดจำเพื่อยืนยันคิว`, `Slot held until ${fmt.time(b.deposit_due_at)}. Pay the deposit to confirm it.`)}</span>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying(true)}>{L("ชำระมัดจำ", "Pay deposit")} <Money value={api.bookings.config.depositAmount || 200} /></button>
                </div>
            )}
            {b.status === "PENDING" && <div className="notice warn">{L("รอร้านยืนยันคิว ปกติภายใน 1 ชั่วโมงในเวลาทำการ", "Waiting for the shop to confirm — usually within an hour during opening hours.")}</div>}
            {b.status === "CONFIRMED" && <div className="notice ok">{L("ยืนยันคิวแล้ว นำเครื่องและอุปกรณ์ชาร์จมาตามเวลานัด", "Confirmed. Bring the device and its charger at your appointment time.")}</div>}
            {b.status === "COMPLETED" && b.work_order_id && (
                <div className="notice ok">
                    <span>{L("ร้านรับเครื่องแล้ว ", "We've received your device. ")}<Link to={`/my/repairs/${b.work_order_id}`}>{L("ติดตามงานซ่อม", "Track the repair")}</Link></span>
                </div>
            )}
            {b.status === "NO_SHOW" && <div className="notice error">{L("ร้านบันทึกว่าคุณไม่ได้มาตามนัดนี้ ถ้าต้องการซ่อม จองคิวใหม่ได้เลย", "The shop recorded that you missed this appointment. Book a new one any time.")}</div>}
            {b.status === "CANCELLED" && <div className="notice error">{L("ยกเลิกแล้ว", "Cancelled")}{b.cancellation_reason ? ` — ${reasonText(b.cancellation_reason)}` : ""}</div>}

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
                    {dep && (<><dt>{L("มัดจำ", "Deposit")}</dt><dd><DepositNote deposit={dep} />{dep.reference_number ? <span className="faint small"> · {dep.reference_number}</span> : null}</dd></>)}
                </dl>
            </section>

            <section>
                <h2 style={{ marginBottom: 12 }}>{L("ประวัติสถานะ", "Status history")}</h2>
                <ol className="timeline">
                    {b.status_history.map((h) => (
                        <li key={h.history_id}>
                            <strong>{t(`status.booking.${h.new_status}`)}</strong>
                            <div className="faint small">{fmt.dateTime(h.created_at)} · {h.changed_by_name}{h.reason ? ` · ${reasonText(h.reason)}` : ""}</div>
                        </li>
                    ))}
                </ol>
            </section>

            {canCancel && (
                <div>
                    <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)}>{L("ยกเลิกการจอง", "Cancel booking")}</button>
                </div>
            )}

            {paying && (
                <DepositCheckout
                    booking={b}
                    onClose={() => setPaying(false)}
                    onPaid={() => { setPaying(false); booking.reload(); deposit.reload(); }}
                />
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
                        <p className="muted small">{L("คิวนี้จะถูกปล่อยให้คนอื่นจอง และเปิดกลับไม่ได้", "The slot will be released and can't be restored.")}{dep?.status === "PAID" ? L(` มัดจำ ${fmt.money(dep.amount)} จะคืนให้เต็มจำนวน`, ` Your ${fmt.money(dep.amount)} deposit is refunded in full.`) : ""}</p>
                        <TextField as="textarea" label={L("เหตุผล (ไม่บังคับ)", "Reason (optional)")} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                </Modal>
            )}
        </div>
    );
}
