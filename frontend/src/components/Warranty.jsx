import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";

/**
 * Tasks 11 and 12: the warranty of a repaired device, and the link between a
 * warranty claim and the original repair. `base` is the work-order path for
 * the current role, e.g. "/admin/work-orders" or "/my/repairs"; without it
 * (technicians cannot open other jobs) numbers are shown without links.
 */
function WoLink({ base, wo }) {
    return base
        ? <Link to={`${base}/${wo.work_order_id}`} className="num">{wo.work_order_number}</Link>
        : <span className="num">{wo.work_order_number}</span>;
}

export function WarrantyNotice({ w, base, children }) {
    const { L, fmt } = useI18n();
    const parent = w.warranty_parent;
    const claims = w.warranty_claims || [];
    if (!w.warranty && !parent && claims.length === 0) return null;

    return (
        <div className="stack">
            {parent && (
                <div className="notice info">
                    {L("งานเคลมประกันจาก ", "Warranty claim for ")}
                    <WoLink base={base} wo={parent} />
                    {base === null
                        ? L(" · ราคาที่เสนอทุกตัวเลือกจะเป็น ฿0 ให้ลูกค้า (ใส่ราคาจริงไว้อ้างอิงได้)", " · every option you offer is ฿0 for the customer (enter real prices for reference)")
                        : L(" · ไม่มีค่าใช้จ่าย", " · free of charge")}
                </div>
            )}
            {w.warranty && (
                <div className={`notice ${w.warranty.active ? "ok" : "warn"}`}>
                    {w.warranty.active
                        ? L(
                            `รับประกัน ${w.warranty.days} วัน ถึง ${fmt.dateLong(w.warranty.until)} (เหลือ ${w.warranty.days_left} วัน) ครอบคลุมค่าแรงและอะไหล่ที่ร้านเปลี่ยน`,
                            `${w.warranty.days}-day warranty until ${fmt.dateLong(w.warranty.until)} (${w.warranty.days_left} days left): labour and the parts we replaced.`
                        )
                        : L(`ประกันหมดเมื่อ ${fmt.dateLong(w.warranty.until)}`, `Warranty ended on ${fmt.dateLong(w.warranty.until)}`)}
                    {children}
                </div>
            )}
            {claims.length > 0 && (
                <p className="small muted">
                    {L("ใบงานเคลมประกัน: ", "Warranty claims: ")}
                    {claims.map((c, i) => (
                        <span key={c.work_order_id}>
                            {i > 0 && ", "}
                            <WoLink base={base} wo={c} />
                        </span>
                    ))}
                </p>
            )}
        </div>
    );
}
