import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, PageHead, useAction } from "../../components/ui.jsx";
import "../admin/admin.css";

/**
 * Bookings coming in today and tomorrow. A technician sees what devices are
 * on the way and takes a job before it arrives; check-in then hands the work
 * order straight to them.
 */
export default function TechQueue() {
    const { L, fmt } = useI18n();
    const { user } = useAuth();
    const queue = useAsync(() => api.bookings.queue({ days: 2 }), []);
    const [run, busy] = useAction();

    async function take(b) {
        await run(() => api.bookings.claim(b.booking_id), L(`รับงาน ${b.booking_number} แล้ว`, `You took ${b.booking_number}`)).catch(() => null);
        queue.reload();
    }

    async function giveBack(b) {
        await run(() => api.bookings.release(b.booking_id), L("คืนงานเข้าคิวแล้ว", "Job given back")).catch(() => null);
        queue.reload();
    }

    const items = queue.data || [];
    const days = [...new Set(items.map((b) => b.appointment_date))];
    const mine = items.filter((b) => b.technician_id === user?.user_id).length;
    const free = items.filter((b) => !b.technician_id).length;

    return (
        <div className="stack-lg">
            <PageHead
                title={L("คิวที่จะเข้ามา", "Upcoming queue")}
                lede={L("นัดซ่อมวันนี้และพรุ่งนี้ กดรับงานไว้ก่อนได้ พอร้านรับเครื่อง ใบงานจะมาที่ “งานของฉัน” ทันที", "Today's and tomorrow's appointments. Take a job ahead of time; once the shop checks the device in, the work order lands in My jobs.")}
            />
            {queue.data && (
                <p className="muted">
                    {L(`ทั้งหมด ${items.length} คิว · คุณรับไว้ ${mine} · ยังไม่มีคนรับ ${free}`, `${items.length} appointments · ${mine} yours · ${free} not taken`)}
                </p>
            )}
            {queue.loading && !queue.data && <Loading />}
            <ErrorNotice error={queue.error} onRetry={queue.reload} />
            {queue.data && items.length === 0 && (
                <Empty title={L("ยังไม่มีนัดวันนี้และพรุ่งนี้", "No appointments today or tomorrow")}>
                    {L("การจองใหม่จะขึ้นที่นี่ทันทีที่ลูกค้าจอง", "New bookings show up here as soon as customers book.")}
                </Empty>
            )}
            {days.map((day) => (
                <section key={day} className="stack">
                    <h2>{fmt.day(day)}</h2>
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{L("เวลา", "Time")}</th>
                                    <th>{L("บริการ / เครื่อง", "Service / device")}</th>
                                    <th>{L("อาการที่แจ้ง", "Reported symptom")}</th>
                                    <th className="right">{L("ช่าง", "Technician")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.filter((b) => b.appointment_date === day).map((b) => (
                                    <tr key={b.booking_id}>
                                        <td className="num">{b.appointment_time}<div className="faint small">{b.booking_number}</div></td>
                                        <td>{b.service_name}<div className="faint small">{[b.device_type, b.brand, b.model].filter(Boolean).join(" · ")}</div></td>
                                        <td className="small">{b.reported_symptom}</td>
                                        <td className="right">
                                            {!b.technician_id && (
                                                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => take(b)}>{L("รับงานนี้", "Take this job")}</button>
                                            )}
                                            {b.technician_id === user?.user_id && (
                                                <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                                    <span className="badge tone-green">{L("คุณรับไว้", "Yours")}</span>
                                                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => giveBack(b)}>{L("คืนงาน", "Give back")}</button>
                                                </div>
                                            )}
                                            {b.technician_id && b.technician_id !== user?.user_id && (
                                                <span className="badge tone-grey">{L("ช่างคนอื่นรับแล้ว", "Taken")}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ))}
        </div>
    );
}
