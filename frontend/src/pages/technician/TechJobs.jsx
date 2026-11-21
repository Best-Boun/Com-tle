import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Empty, ErrorNotice, Loading, PageHead } from "../../components/ui.jsx";
import Ticket from "../../components/Ticket.jsx";
import { deviceLabel } from "../../components/repair.jsx";
import { Icon } from "../../components/icons.jsx";
import "../admin/admin.css";

const ACTIVE = ["PENDING", "DIAGNOSING", "WAITING_APPROVAL", "APPROVED", "WAITING_PARTS", "REPAIRING", "TESTING"];

/** What the technician should do next, per status. */
function nextStep(w, L) {
    switch (w.status) {
        case "PENDING": return L("เริ่มตรวจเช็ก", "Start diagnosis");
        case "DIAGNOSING": return L("บันทึกผลตรวจและเสนอตัวเลือก", "Record diagnosis & offer options");
        case "WAITING_APPROVAL": return L("รอลูกค้าเลือก", "Waiting for customer");
        case "APPROVED": return L("เริ่มซ่อมได้", "Ready to repair");
        case "WAITING_PARTS": return L("รออะไหล่ แล้วเริ่มซ่อม", "Waiting for parts, then repair");
        case "REPAIRING": return L("ซ่อมแล้วบันทึกผล", "Repair, then record result");
        case "TESTING": return L("บันทึกผลทดสอบ", "Record test result");
        default: return null;
    }
}

export default function TechJobs() {
    const { L, fmt, lang } = useI18n();
    const [tab, setTab] = useState("active");
    const list = useAsync(() => api.repairs.listAssigned(), []);
    const queue = useAsync(() => api.repairs.queue(), []);
    const items = (list.data || []).filter((w) => (tab === "active" ? ACTIVE.includes(w.status) : !ACTIVE.includes(w.status)));
    const actionable = (w) => ["PENDING", "APPROVED", "REPAIRING", "TESTING"].includes(w.status) || (w.status === "DIAGNOSING" && !w.has_pending_quotation);
    items.sort((a, b) => Number(actionable(b)) - Number(actionable(a)));

    const active = (list.data || []).filter((w) => ACTIVE.includes(w.status));
    const kpis = [
        { icon: Icon.Wrench, label: L("ต้องลงมือทำ", "Need you now"), value: active.filter(actionable).length },
        { icon: Icon.Clock, label: L("รอร้าน / ลูกค้า", "Waiting on shop / customer"), value: active.filter((w) => !actionable(w)).length },
        { icon: Icon.Clipboard, label: L("งานรอช่างในคิว", "Waiting in the queue"), value: queue.data ? queue.data.length : "—", to: "/tech/queue" }
    ];

    return (
        <div>
            <PageHead title={L("งานของฉัน", "My jobs")} lede={L("งานที่ต้องลงมือทำอยู่ด้านบน เครื่องที่ร้านรับแล้วแต่ยังไม่มีช่างรับ ดูได้ที่ “คิวงานรอช่าง”", "Jobs that need you are at the top. Received devices nobody has taken yet are in the queue.")} />
            <div className="kpi-row" style={{ marginBottom: 24 }}>
                {kpis.map((k) => {
                    const body = (
                        <>
                            <span className="kpi-icon"><k.icon /></span>
                            <span className="kpi-label">{k.label}</span>
                            <strong className="num">{list.data || k.to ? k.value : "—"}</strong>
                        </>
                    );
                    return k.to
                        ? <Link key={k.label} to={k.to} className="kpi" style={{ textDecoration: "none", color: "inherit" }}>{body}</Link>
                        : <div key={k.label} className="kpi">{body}</div>;
                })}
            </div>
            <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
                <button type="button" role="tab" className="tab" aria-selected={tab === "active"} onClick={() => setTab("active")}>{L("กำลังทำ", "Active")}</button>
                <button type="button" role="tab" className="tab" aria-selected={tab === "done"} onClick={() => setTab("done")}>{L("เสร็จ / ยกเลิก", "Done / cancelled")}</button>
            </div>
            {list.loading && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data && items.length === 0 && <Empty title={tab === "active" ? L("ไม่มีงานค้าง", "No active jobs") : L("ยังไม่มีงานที่เสร็จ", "No finished jobs yet")}>{tab === "active" && L("งานที่คุณรับจากคิว หรือที่ร้านมอบหมาย จะขึ้นที่นี่", "Jobs you take from the queue, or that the shop assigns, appear here.")}</Empty>}
            <div className="ticket-list">
                {items.map((w) => (
                    <Ticket
                        key={w.work_order_id}
                        to={`/tech/jobs/${w.work_order_id}`}
                        walkIn={w.source === "WALK_IN"}
                        number={w.work_order_number}
                        title={`${deviceLabel(w, lang)} · ${w.reported_symptom}`}
                        meta={[w.service_name, `${L("อัปเดต", "Updated")} ${fmt.dateTime(w.updated_at)}`]}
                        kind="wo"
                        status={w.status}
                        stub={nextStep(w, L) && <span className={`small ${actionable(w) ? "" : "faint"}`}>{nextStep(w, L)}</span>}
                    />
                ))}
            </div>
        </div>
    );
}
