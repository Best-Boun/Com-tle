import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { deviceLabel } from "../../components/repair.jsx";
import { Empty, ErrorNotice, Loading, PageHead, useAction } from "../../components/ui.jsx";
import "../admin/admin.css";

/**
 * Devices the shop has received that no technician has taken yet, oldest
 * first. A technician takes one and it moves to My jobs; whoever presses
 * first gets it.
 */
export default function TechQueue() {
    const { L, t, fmt, lang } = useI18n();
    const navigate = useNavigate();
    const queue = useAsync(() => api.repairs.queue(), []);
    const [run, busy] = useAction();

    async function take(w) {
        const taken = await run(
            () => api.repairs.claim(w.work_order_id),
            L(`รับงาน ${w.work_order_number} แล้ว`, `You took ${w.work_order_number}`)
        ).catch(() => null);
        if (taken) navigate(`/tech/jobs/${w.work_order_id}`);
        else queue.reload();
    }

    const items = queue.data || [];
    const waitingHours = (w) => Math.floor((Date.now() - new Date(w.received_at || w.created_at).getTime()) / 3600000);

    return (
        <div className="stack-lg">
            <PageHead
                title={L("คิวงานรอช่าง", "Jobs waiting for a technician")}
                lede={L(
                    "เครื่องที่ร้านรับเข้ามาแล้วแต่ยังไม่มีช่างรับ เรียงจากที่รอนานที่สุด กดรับงานแล้วงานจะไปอยู่ที่ “งานของฉัน” ใครกดก่อนได้ก่อน",
                    "Devices the shop has received that nobody has taken yet, longest waiting first. Take one and it moves to My jobs; first come, first served."
                )}
                actions={<button type="button" className="btn btn-secondary" disabled={queue.loading} onClick={queue.reload}>{L("รีเฟรช", "Refresh")}</button>}
            />
            {queue.data && <p className="muted">{L(`รอช่าง ${items.length} งาน`, `${items.length} waiting`)}</p>}
            {queue.loading && !queue.data && <Loading />}
            <ErrorNotice error={queue.error} onRetry={queue.reload} />
            {queue.data && items.length === 0 && (
                <Empty title={L("ไม่มีงานรอช่าง", "Nothing waiting")}>
                    {L("เครื่องที่ร้านรับเข้ามาใหม่จะขึ้นที่นี่", "Newly received devices show up here.")}
                </Empty>
            )}
            {items.length > 0 && (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{L("รับเครื่องเมื่อ", "Received")}</th>
                                <th>{L("เครื่อง", "Device")}</th>
                                <th>{L("อาการที่แจ้ง", "Reported symptom")}</th>
                                <th className="right">{L("ดำเนินการ", "Action")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((w) => (
                                <tr key={w.work_order_id}>
                                    <td className="num">
                                        {fmt.dateTime(w.received_at || w.created_at)}
                                        <div className="faint small">{w.work_order_number} · {t(`source.${w.source}`)}</div>
                                        {waitingHours(w) >= 24 && <div className="small" style={{ color: "var(--red)" }}>{L(`รอมา ${Math.floor(waitingHours(w) / 24)} วัน`, `Waiting ${Math.floor(waitingHours(w) / 24)} d`)}</div>}
                                    </td>
                                    <td>{deviceLabel(w, lang)}<div className="faint small">{w.service_name}</div></td>
                                    <td className="small">{w.reported_symptom}</td>
                                    <td className="right">
                                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => take(w)}>{L("รับงานนี้", "Take this job")}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
