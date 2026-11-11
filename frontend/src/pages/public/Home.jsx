import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { WO_STAGES } from "../../i18n/dictionary.js";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Money, Stamp } from "../../components/ui.jsx";
import "./home.css";

/** The hero ticket walks through the repair stages once, then rests on "Repair done". */
function HeroTicket() {
    const { L, t } = useI18n();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [stage, setStage] = useState(reduce ? WO_STAGES.length - 1 : 0);

    useEffect(() => {
        if (reduce || stage >= WO_STAGES.length - 1) return undefined;
        const id = setTimeout(() => setStage((s) => s + 1), stage === 0 ? 700 : 520);
        return () => clearTimeout(id);
    }, [stage, reduce]);

    const status = WO_STAGES[stage];
    return (
        <div className="hero-ticket" aria-label={L("ตัวอย่างใบงานซ่อม", "Example repair ticket")}>
            <div className="ticket">
                <div className="ticket-tag" aria-hidden="true" />
                <div className="ticket-body">
                    <span className="faint small">{L("ใบงานซ่อม", "Repair ticket")}</span>
                    <span className="ticket-number">WO-0127</span>
                    <span className="ticket-title">Lenovo IdeaPad 5 · {L("เปิดไม่ติด จอดำ", "Won't boot, black screen")}</span>
                    <dl className="facts">
                        <dt>{L("ผลตรวจ", "Diagnosis")}</dt>
                        <dd>{L("SSD เสีย บอร์ดและจอปกติ", "Failed SSD, board and screen OK")}</dd>
                        <dt>{L("ราคาที่อนุมัติ", "Approved price")}</dt>
                        <dd><Money value={1790} /></dd>
                    </dl>
                    <ol className="steps hero-steps" style={{ "--count": WO_STAGES.length }}>
                        {WO_STAGES.map((s, i) => (
                            <li key={s} className={i < stage ? "done" : i === stage ? "current" : ""}>
                                <span>{t(`status.wo.${s}`)}</span>
                            </li>
                        ))}
                    </ol>
                    <Stamp key={status} kind="wo" status={status} className="hero-stamp" />
                </div>
            </div>
        </div>
    );
}

export default function Home() {
    const { L } = useI18n();
    const services = useAsync(() => api.catalog.listServices(), []);

    const steps = [
        { th: "จองคิวออนไลน์", en: "Book online", dth: "เลือกบริการและเวลาที่สะดวก ไม่ต้องรอหน้าร้าน", den: "Pick a service and a time that suits you." },
        { th: "นำเครื่องมาส่ง", en: "Drop off your device", dth: "ร้านออกใบงานพร้อมเลขติดตามให้ทันที", den: "We open a repair ticket you can track." },
        { th: "อนุมัติราคาก่อนซ่อม", en: "Approve the price first", dth: "ช่างตรวจแล้วส่งใบเสนอราคา เราไม่ซ่อมจนกว่าคุณกดอนุมัติ", den: "We only start once you approve the quotation." },
        { th: "ชำระเงินและรับเครื่อง", en: "Pay and pick up", dth: "ทดสอบก่อนส่งมอบทุกเครื่อง แบ่งชำระได้", den: "Every device is tested before handover." }
    ];

    return (
        <div className="home">
            <section className="hero">
                <div>
                    <h1>{L("รู้ทุกขั้นตอนว่าเครื่องคุณถึงไหนแล้ว", "Know exactly where your repair is")}</h1>
                    <p className="hero-lede">
                        {L(
                            "ร้านซ่อมคอมพิวเตอร์และโน้ตบุ๊กที่ให้คุณจองคิว อนุมัติราคา และติดตามงานซ่อมได้เองจากมือถือ",
                            "A computer and laptop repair shop where you book, approve prices and follow every step of the repair from your phone."
                        )}
                    </p>
                    <div className="btn-row">
                        <Link to="/book" className="btn btn-primary btn-lg">{L("จองคิวซ่อม", "Book a repair")}</Link>
                        <Link to="/services" className="btn btn-secondary btn-lg">{L("ดูบริการและราคา", "See services & prices")}</Link>
                    </div>
                </div>
                <HeroTicket />
            </section>

            <section className="home-section" aria-labelledby="how">
                <h2 id="how">{L("ซ่อมกับเราใน 4 ขั้นตอน", "How a repair works")}</h2>
                <ol className="how-list">
                    {steps.map((s, i) => (
                        <li key={s.en}>
                            <span className="how-num num">{i + 1}</span>
                            <div>
                                <h3>{L(s.th, s.en)}</h3>
                                <p className="muted">{L(s.dth, s.den)}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="home-section" aria-labelledby="popular">
                <div className="panel-head">
                    <h2 id="popular">{L("บริการยอดนิยม", "Popular services")}</h2>
                    <Link to="/services">{L("ดูทั้งหมด", "See all")}</Link>
                </div>
                {services.data && (
                    <ul className="price-list">
                        {services.data.slice(0, 5).map((s) => (
                            <li key={s.service_id}>
                                <span>{s.service_name}</span>
                                <span className="price-dots" aria-hidden="true" />
                                <span className="num">{L("เริ่ม", "from")} <Money value={s.starting_price} /></span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="small faint" style={{ marginTop: 12 }}>
                    {L("ราคาเริ่มต้นเป็นค่าแรง ราคาจริงขึ้นกับผลตรวจและอะไหล่ ร้านจะส่งใบเสนอราคาให้อนุมัติก่อนเสมอ", "Starting prices cover labour. The final price depends on the diagnosis and parts — you always approve a quotation first.")}
                </p>
            </section>

            <section className="home-section shop-info" aria-labelledby="visit">
                <h2 id="visit">{L("หน้าร้าน", "Visit the shop")}</h2>
                <dl className="facts">
                    <dt>{L("เวลาเปิด", "Hours")}</dt>
                    <dd>{L("ทุกวัน 09:00–17:00 (พัก 12:00–13:00)", "Daily 09:00–17:00 (lunch 12:00–13:00)")}</dd>
                    <dt>{L("ที่อยู่", "Address")}</dt>
                    <dd>{L("123 ถ.พหลโยธิน แขวงจตุจักร กรุงเทพฯ 10900", "123 Phahonyothin Rd, Chatuchak, Bangkok 10900")}</dd>
                    <dt>{L("โทร", "Phone")}</dt>
                    <dd><a href="tel:021234567">02-123-4567</a></dd>
                </dl>
            </section>
        </div>
    );
}
