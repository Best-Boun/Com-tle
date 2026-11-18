import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, PageHead } from "../../components/ui.jsx";
import Ticket from "../../components/Ticket.jsx";
import { deviceLine, symptomLabel } from "../../utils/requestLabels.js";

export default function MyBookings() {
    const { L, t, fmt } = useI18n();
    const [tab, setTab] = useState("upcoming");
    const list = useAsync(() => api.bookings.listMine(), []);

    const items = (list.data || []).filter((b) =>
        tab === "upcoming" ? ["PENDING", "CONFIRMED"].includes(b.status) : !["PENDING", "CONFIRMED"].includes(b.status)
    );

    return (
        <div>
            <PageHead
                title={L("การแจ้งซ่อมของฉัน", "My repair requests")}
                lede={L("คำขอที่ยังรอนำเครื่องมา แจ้งเลขคำขอหรือเบอร์โทรที่หน้าร้านได้เลย", "Requests waiting for your device. Give the number or your phone at the counter.")}
                actions={<Link to="/book" className="btn btn-primary">{L("แจ้งซ่อมใหม่", "New request")}</Link>}
            />
            <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
                <button type="button" role="tab" className="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")}>{L("รอนำเครื่องมา", "Waiting for the device")}</button>
                <button type="button" role="tab" className="tab" aria-selected={tab === "past"} onClick={() => setTab("past")}>{L("ที่ผ่านมา", "Past")}</button>
            </div>
            {list.loading && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data && items.length === 0 && (
                <Empty
                    title={tab === "upcoming" ? L("ไม่มีคำขอที่รอนำเครื่องมา", "No open requests") : L("ยังไม่มีประวัติการแจ้งซ่อม", "No past requests")}
                    action={tab === "upcoming" && <Link to="/book" className="btn btn-primary">{L("แจ้งซ่อมล่วงหน้า", "Tell us before you come")}</Link>}
                >
                    {tab === "upcoming" && L("บอกอาการไว้ก่อน แล้วนำเครื่องมาเมื่อสะดวก ไม่ต้องนัดเวลา หรือเดินเข้าร้านได้เลยก็ได้", "Tell us what's wrong, then bring it in when it suits you — or just walk in.")}
                </Empty>
            )}
            <div className="ticket-list">
                {items.map((b) => (
                    <Ticket
                        key={b.booking_id}
                        to={`/my/bookings/${b.booking_id}`}
                        number={b.booking_number}
                        title={b.symptom_group ? symptomLabel(t, b.symptom_group) : b.service_name}
                        meta={[
                            b.scheduled_at ? `${L("นัด", "Appointment")} ${fmt.dateLong(b.scheduled_at)} · ${b.appointment_time}` : `${L("แจ้งเมื่อ", "Sent")} ${fmt.dateLong(b.created_at)}`,
                            deviceLine(t, b)
                        ]}
                        kind="booking"
                        status={b.status}
                    />
                ))}
            </div>
        </div>
    );
}
