import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { deviceLine, symptomLabel } from "../../utils/requestLabels.js";
import { ErrorNotice, Loading, Modal, PageHead, StatusBadge, TextField, useAction } from "../../components/ui.jsx";
import "./admin.css";

const OPEN = ["PENDING", "CONFIRMED"];

/**
 * Repair requests at the counter: the customer walks in, staff find their
 * request by its number (RQ-...) or phone, and check the device in, which
 * opens the work order.
 */
export default function AdminBookings() {
    const { L, t, fmt } = useI18n();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const status = params.get("status") ?? "PENDING";
    const search = params.get("q") || "";
    const [typed, setTyped] = useState(search);
    const list = useAsync(() => api.bookings.listAll({ status, search }), [status, search]);
    const [run, busy] = useAction();
    const [cancelling, setCancelling] = useState(null);
    const [checkingIn, setCheckingIn] = useState(null);
    const [text, setText] = useState("");
    const [intakeTermsAcknowledged, setIntakeTermsAcknowledged] = useState(false);

    useEffect(() => setTyped(search), [search]);

    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        next.set(key, value);
        if (!value && key === "q") next.delete(key);
        setParams(next, { replace: true });
    };

    function submitSearch(e) {
        e.preventDefault();
        const next = new URLSearchParams(params);
        if (typed.trim()) {
            next.set("q", typed.trim());
            // A search at the counter looks through every status.
            next.set("status", "");
        } else {
            next.delete("q");
        }
        setParams(next, { replace: true });
    }

    async function cancel() {
        const ok = await run(() => api.bookings.cancel(cancelling.booking_id, text), L("ยกเลิกคำขอแล้ว", "Request cancelled")).catch(() => null);
        if (ok) {
            setCancelling(null);
            setText("");
            list.reload();
        }
    }

    async function checkIn() {
        const result = await run(
            () => api.bookings.checkIn(checkingIn.booking_id, { accessories: text, intake_terms_acknowledged: intakeTermsAcknowledged }),
            L("รับเครื่องและเปิดใบงานแล้ว", "Device received, work order opened")
        ).catch(() => null);
        if (result) navigate(`/admin/work-orders/${result.work_order.work_order_id}`);
    }

    const waitingDays = (b) => Math.floor((Date.now() - new Date(b.created_at).getTime()) / 86400000);

    return (
        <div>
            <PageHead
                title={L("คำขอแจ้งซ่อม", "Repair requests")}
                lede={L(
                    "ลูกค้าที่แจ้งซ่อมไว้ล่วงหน้า เมื่อลูกค้านำเครื่องมา ค้นจากเลขคำขอหรือเบอร์โทร แล้วกด “รับเครื่อง” เพื่อเปิดใบงาน ลูกค้าที่ไม่ได้แจ้งไว้ ใช้ “รับเครื่อง walk-in”",
                    "Customers who told us before coming in. When they arrive, search by request number or phone and press Check in to open the work order. Customers without a request go through Walk-in."
                )}
            />
            <form className="filters" onSubmit={submitSearch}>
                <TextField
                    label={L("ค้นหาเลขคำขอหรือเบอร์โทร", "Request number or phone")}
                    placeholder="RQ-20261119-… / 0812345678"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">{L("ค้นหา", "Search")}</button>
                <TextField as="select" label={L("สถานะ", "Status")} value={status} onChange={(e) => setFilter("status", e.target.value)}>
                    <option value="">{t("common.all")}</option>
                    {["PENDING", "COMPLETED", "CANCELLED", "EXPIRED", "CONFIRMED", "NO_SHOW"].map((s) => <option key={s} value={s}>{t(`status.booking.${s}`)}</option>)}
                </TextField>
                {(search || status !== "PENDING") && (
                    <button type="button" className="btn btn-ghost" onClick={() => { setTyped(""); setParams({}, { replace: true }); }}>{L("ล้างตัวกรอง", "Clear filters")}</button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => navigate("/admin/work-orders/new")}>{L("รับเครื่อง walk-in", "Walk-in")}</button>
            </form>
            {list.loading && !list.data && <Loading />}
            <ErrorNotice error={list.error} onRetry={list.reload} />
            {list.data && (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{L("แจ้งเมื่อ", "Sent")}</th>
                                <th>{L("เลขที่คำขอ", "Request")}</th>
                                <th>{L("ลูกค้า / ติดต่อ", "Customer / contact")}</th>
                                <th>{L("เครื่อง / อาการ", "Device / problem")}</th>
                                <th>{L("สถานะ", "Status")}</th>
                                <th className="right">{L("ดำเนินการ", "Actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.data.length === 0 && (
                                <tr><td colSpan={6} className="muted">
                                    {search
                                        ? L("ไม่พบคำขอ ถ้าลูกค้าไม่ได้แจ้งไว้ ใช้ “รับเครื่อง walk-in”", "No request found. If the customer didn't send one, use Walk-in.")
                                        : L("ไม่มีคำขอตามตัวกรองนี้", "No requests match these filters.")}
                                </td></tr>
                            )}
                            {list.data.map((b) => (
                                <tr key={b.booking_id}>
                                    <td className="num">
                                        {fmt.dateTime(b.created_at)}
                                        {b.appointment_date && <div className="faint small">{L("นัด", "Appt.")} {fmt.day(b.appointment_date)} {b.appointment_time}</div>}
                                    </td>
                                    <td className="num">{b.booking_number}</td>
                                    <td>
                                        {b.customer_name}
                                        {b.contact_phone && <div className="faint small">{b.contact_name !== b.customer_name ? `${b.contact_name} · ` : ""}<span className="num">{b.contact_phone}</span></div>}
                                    </td>
                                    <td>
                                        {deviceLine(t, b)}
                                        <div className="faint small">{b.symptom_group ? `${symptomLabel(t, b.symptom_group)} — ` : ""}{b.reported_symptom}</div>
                                    </td>
                                    <td>
                                        <StatusBadge kind="booking" status={b.status} />
                                        {b.status === "PENDING" && waitingDays(b) >= 7 && (
                                            <div className="small" style={{ color: "var(--red)" }}>{L(`รอมา ${waitingDays(b)} วัน`, `Waiting ${waitingDays(b)} days`)}</div>
                                        )}
                                    </td>
                                    <td className="right">
                                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                                            {OPEN.includes(b.status) && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setText(""); setIntakeTermsAcknowledged(false); setCheckingIn(b); }}>{L("รับเครื่อง", "Check in")}</button>}
                                            {OPEN.includes(b.status) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(""); setCancelling(b); }}>{t("common.cancel")}</button>}
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
                            <button type="button" className="btn btn-secondary" onClick={() => setCancelling(null)}>{L("ไม่ยกเลิก", "Keep it")}</button>
                            <button type="button" className="btn btn-danger" disabled={busy || !text.trim()} onClick={cancel}>{L("ยกเลิกคำขอ", "Cancel request")}</button>
                        </>
                    )}
                >
                    <TextField as="textarea" label={L("เหตุผล (บังคับ)", "Reason (required)")} hint={L("ลูกค้าจะเห็นเหตุผลนี้", "The customer sees this.")} value={text} onChange={(e) => setText(e.target.value)} />
                </Modal>
            )}

            {checkingIn && (
                <Modal
                    title={L(`รับเครื่อง ${checkingIn.booking_number}`, `Check in ${checkingIn.booking_number}`)}
                    onClose={() => setCheckingIn(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setCheckingIn(null)}>{t("common.cancel")}</button>
                            <button type="button" className="btn btn-primary" disabled={busy || !intakeTermsAcknowledged} onClick={checkIn}>{L("รับเครื่องและเปิดใบงาน", "Check in & open work order")}</button>
                        </>
                    )}
                >
                    <div className="stack">
                        <dl className="facts">
                            <dt>{L("ลูกค้า", "Customer")}</dt><dd>{checkingIn.customer_name}{checkingIn.contact_phone ? ` · ${checkingIn.contact_phone}` : ""}</dd>
                            <dt>{L("เครื่อง", "Device")}</dt><dd>{deviceLine(t, checkingIn)}{checkingIn.serial_number ? ` · S/N ${checkingIn.serial_number}` : ""}</dd>
                            {checkingIn.symptom_group && (<><dt>{L("กลุ่มอาการ", "Kind of problem")}</dt><dd>{symptomLabel(t, checkingIn.symptom_group)}</dd></>)}
                            <dt>{L("อาการ", "Symptom")}</dt><dd>{checkingIn.reported_symptom}</dd>
                        </dl>
                        <TextField label={L("อุปกรณ์ที่ลูกค้าฝากไว้", "Accessories left with the device")} placeholder={L("เช่น อะแดปเตอร์ชาร์จ กระเป๋า", "e.g. charger, bag")} value={text} onChange={(e) => setText(e.target.value)} />
                        <label className="small" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <input type="checkbox" checked={intakeTermsAcknowledged} onChange={(e) => setIntakeTermsAcknowledged(e.target.checked)} />
                            <span>{L("ลูกค้ารับทราบเงื่อนไขการรับเครื่องและรายการอุปกรณ์ที่ฝากไว้", "The customer acknowledges the intake terms and accessories listed.")}</span>
                        </label>
                        <p className="small faint">{L("ใบงานจะเข้าคิวช่าง ช่างกดรับงานเองหรือมอบหมายได้ในหน้าใบงาน · 1 คำขอเปิดใบงานได้ 1 ใบ", "The work order goes into the technicians' queue; a technician takes it, or assign one on the work order. One request opens exactly one work order.")}</p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
