import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, PageHead } from "../../components/ui.jsx";
import Ticket from "../../components/Ticket.jsx";

export default function MyBookings() {
    const { L, fmt } = useI18n();
    const [tab, setTab] = useState("upcoming");
    const list = useAsync(() => api.bookings.listMine(), []);

    const items = (list.data || []).filter((b) =>
        tab === "upcoming" ? ["PENDING", "CONFIRMED"].includes(b.status) : ["COMPLETED", "CANCELLED"].includes(b.status)
    );
    if (tab === "upcoming") items.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

    return (
        <div>
            <PageHead
                title={L("การจองของฉัน", "My bookings")}
                actions={<Link to="/book" className="btn btn-primary">{L("จองคิวใหม่", "New booking")}</Link>}
            />
            <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
                <button type="button" role="tab" className="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")}>{L("กำลังจะถึง", "Upcoming")}</button>
                <button type="button" role="tab" className="tab" aria-selected={tab === "past"} onClick={() => setTab("past")}>{L("ที่ผ่านมา", "Past")}</button>
            </div>
            {list.loading && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data && items.length === 0 && (
                <Empty
                    title={tab === "upcoming" ? L("ยังไม่มีคิวที่กำลังจะถึง", "No upcoming bookings") : L("ยังไม่มีประวัติการจอง", "No past bookings")}
                    action={tab === "upcoming" && <Link to="/book" className="btn btn-primary">{L("จองคิวซ่อม", "Book a repair")}</Link>}
                >
                    {tab === "upcoming" && L("เลือกบริการและเวลาที่สะดวก ร้านจะยืนยันคิวให้", "Pick a service and time — the shop will confirm it.")}
                </Empty>
            )}
            <div className="ticket-list">
                {items.map((b) => (
                    <Ticket
                        key={b.booking_id}
                        to={`/my/bookings/${b.booking_id}`}
                        number={b.booking_number}
                        title={b.service_name}
                        meta={[`${fmt.dateLong(b.scheduled_at)} · ${b.appointment_time}`, [b.device_type, b.brand, b.model].filter(Boolean).join(" ")]}
                        kind="booking"
                        status={b.status}
                    />
                ))}
            </div>
        </div>
    );
}
