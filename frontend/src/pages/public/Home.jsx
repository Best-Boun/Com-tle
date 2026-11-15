import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { WO_STAGES } from "../../i18n/dictionary.js";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { Money, Stamp } from "../../components/ui.jsx";
import { CategoryIcon, Icon } from "../../components/icons.jsx";
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

/** Open laptop on the bench; its screen runs a diagnostic. Decorative only. */
function BenchLaptop() {
    return (
        <svg className="bench-laptop" viewBox="0 0 520 340" aria-hidden="true">
            <defs>
                <linearGradient id="lid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#24333d" />
                    <stop offset="1" stopColor="#16222b" />
                </linearGradient>
                <linearGradient id="deck" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#c9d2cf" />
                    <stop offset="1" stopColor="#9aa6a2" />
                </linearGradient>
            </defs>
            <rect x="70" y="18" width="380" height="250" rx="14" fill="url(#lid)" />
            <rect x="86" y="34" width="348" height="218" rx="4" fill="#0a1a14" />
            <g fontFamily="IBM Plex Sans Thai, sans-serif" fontSize="12" fill="#7cd6aa">
                <text x="104" y="62" fontWeight="600" fill="#e7f2ec">SmartFix Diagnostics</text>
                <text x="104" y="92">CPU</text>
                <text x="104" y="118">RAM</text>
                <text x="104" y="144">SSD</text>
                <text x="104" y="170">Battery</text>
                <text x="104" y="196">Fan</text>
            </g>
            <g>
                <rect x="170" y="83" width="200" height="10" rx="5" fill="#13302a" /><rect x="170" y="83" width="200" height="10" rx="5" fill="#12805b" />
                <rect x="170" y="109" width="200" height="10" rx="5" fill="#13302a" /><rect x="170" y="109" width="200" height="10" rx="5" fill="#12805b" />
                <rect x="170" y="135" width="200" height="10" rx="5" fill="#13302a" /><rect x="170" y="135" width="62" height="10" rx="5" fill="#e4924a" className="diag-bar" />
                <rect x="170" y="161" width="200" height="10" rx="5" fill="#13302a" /><rect x="170" y="161" width="168" height="10" rx="5" fill="#12805b" />
                <rect x="170" y="187" width="200" height="10" rx="5" fill="#13302a" /><rect x="170" y="187" width="200" height="10" rx="5" fill="#12805b" />
            </g>
            <g fontFamily="IBM Plex Sans Thai, sans-serif" fontSize="12" fontWeight="600">
                <text x="382" y="92" fill="#7cd6aa">OK</text>
                <text x="382" y="118" fill="#7cd6aa">OK</text>
                <text x="382" y="144" fill="#e4924a">FAIL</text>
                <text x="382" y="170" fill="#7cd6aa">84%</text>
                <text x="382" y="196" fill="#7cd6aa">OK</text>
            </g>
            <rect x="104" y="218" width="120" height="20" rx="4" fill="#12805b" opacity=".25" />
            <path d="M30 268h460l-26 34H56z" fill="url(#deck)" />
            <rect x="214" y="270" width="92" height="8" rx="4" fill="#7f8b88" />
            <path d="M56 302h408v8a6 6 0 0 1-6 6H62a6 6 0 0 1-6-6z" fill="#6f7b78" />
            {/* screwdriver lying on the bench */}
            <g transform="translate(330 318) rotate(-8)">
                <rect x="0" y="-6" width="58" height="12" rx="6" fill="#c8732a" />
                <rect x="10" y="-6" width="4" height="12" fill="#a95c1c" />
                <rect x="22" y="-6" width="4" height="12" fill="#a95c1c" />
                <rect x="58" y="-2" width="62" height="4" rx="2" fill="#b7c0bd" />
            </g>
        </svg>
    );
}

export default function Home() {
    const { L } = useI18n();
    const data = useAsync(async () => {
        const [categories, services] = await Promise.all([api.catalog.listCategories(), api.catalog.listServices()]);
        return { categories, services };
    }, []);
    const codeOf = (categoryId) => data.data?.categories.find((c) => c.category_id === categoryId)?.category_code;

    const promises = [
        { th: "ตรวจเช็กก่อน แจ้งราคาก่อนซ่อมทุกครั้ง", en: "Checked first, priced before any work" },
        { th: "ติดตามสถานะงานซ่อมได้เองออนไลน์", en: "Follow every repair step online" },
        { th: "ทดสอบทุกเครื่องก่อนส่งคืน", en: "Every device tested before handover" }
    ];

    const devices = [
        { icon: Icon.Laptop, th: "โน้ตบุ๊ก", en: "Laptops", dth: "เปิดไม่ติด จอเสีย แบตเสื่อม", den: "No power, screen, battery" },
        { icon: Icon.Tower, th: "คอมตั้งโต๊ะ / PC ประกอบ", en: "Desktops & custom PCs", dth: "บอร์ด พาวเวอร์ซัพพลาย การ์ดจอ", den: "Board, PSU, graphics card" },
        { icon: Icon.Desktop, th: "ออลอินวัน", en: "All-in-ones", dth: "หน้าจอ ฮาร์ดดิสก์ พัดลม", den: "Screen, drive, cooling" },
        { icon: Icon.Memory, th: "อัปเกรดเครื่อง", en: "Upgrades", dth: "เพิ่ม RAM เปลี่ยน SSD", den: "More RAM, faster SSD" }
    ];

    const steps = [
        { th: "จองคิวออนไลน์", en: "Book online", dth: "เลือกบริการและเวลาที่สะดวก ไม่ต้องรอหน้าร้าน", den: "Pick a service and a time that suits you." },
        { th: "นำเครื่องมาส่ง", en: "Drop off your device", dth: "ร้านออกใบงานพร้อมเลขติดตามให้ทันที", den: "We open a repair ticket you can track." },
        { th: "อนุมัติราคาก่อนซ่อม", en: "Approve the price", dth: "ช่างตรวจแล้วส่งใบเสนอราคา ไม่ซ่อมจนกว่าคุณกดอนุมัติ", den: "We only start once you approve the quotation." },
        { th: "ชำระเงินและรับเครื่อง", en: "Pay and pick up", dth: "ทดสอบก่อนส่งมอบทุกเครื่อง แบ่งชำระได้", den: "Tested before handover. Pay in parts if you like." }
    ];

    return (
        <div className="home">
            <section className="hero board-surface bleed">
                <div className="hero-copy">
                    <h1>
                        <span>{L("คอมพังไม่ต้องเดา", "Broken computer?")}</span>{" "}
                        <span>{L("ส่งให้ช่างเราดู", "Let our bench find out why.")}</span>
                    </h1>
                    <p className="hero-lede">
                        {L(
                            "ร้านซ่อมโน้ตบุ๊กและคอมพิวเตอร์ จองคิวออนไลน์ อนุมัติราคาก่อนซ่อม และดูได้ทุกขั้นว่าเครื่องคุณถึงไหนแล้ว",
                            "Laptop and PC repair. Book online, approve the price before we start, and see every step of your repair."
                        )}
                    </p>
                    <div className="btn-row">
                        <Link to="/book" className="btn btn-copper btn-lg">{L("จองคิวซ่อม", "Book a repair")}</Link>
                        <Link to="/services" className="btn btn-onboard btn-lg">{L("ดูบริการและราคา", "Services & prices")}</Link>
                    </div>
                    <ul className="hero-promises">
                        {promises.map((p) => (
                            <li key={p.en}><Icon.Check />{L(p.th, p.en)}</li>
                        ))}
                    </ul>
                </div>
                <div className="hero-bench">
                    <BenchLaptop />
                    <HeroTicket />
                </div>
            </section>

            <section className="device-strip" aria-label={L("เครื่องที่รับซ่อม", "What we fix")}>
                {devices.map((d) => (
                    <div key={d.en} className="device">
                        <span className="device-icon"><d.icon /></span>
                        <div>
                            <strong>{L(d.th, d.en)}</strong>
                            <span className="small muted">{L(d.dth, d.den)}</span>
                        </div>
                    </div>
                ))}
            </section>

            <section className="home-section" aria-labelledby="popular">
                <div className="section-head">
                    <div>
                        <h2 id="popular">{L("บริการและราคาเริ่มต้น", "Services and starting prices")}</h2>
                        <p className="muted">{L("ราคาเริ่มต้นเป็นค่าแรง ราคาจริงขึ้นกับผลตรวจและอะไหล่ ร้านส่งใบเสนอราคาให้อนุมัติก่อนเสมอ", "Starting prices cover labour. You always approve a quotation before we repair.")}</p>
                    </div>
                    <Link to="/services" className="btn btn-secondary">{L("ดูบริการทั้งหมด", "All services")}</Link>
                </div>
                {data.data && (
                    <ul className="service-cards">
                        {data.data.services.slice(0, 6).map((s) => (
                            <li key={s.service_id} className="service-card">
                                <span className="service-card-icon"><CategoryIcon code={codeOf(s.category_id)} /></span>
                                <h3>{s.service_name}</h3>
                                {s.description && <p className="small muted">{s.description}</p>}
                                <div className="service-card-foot">
                                    <span className="price-tag"><span className="small">{L("เริ่ม", "from")}</span> <Money value={s.starting_price} /></span>
                                    <Link to={`/book?service=${s.service_id}`} className="btn btn-ghost btn-sm">{L("จอง", "Book")}</Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="home-section" aria-labelledby="how">
                <h2 id="how">{L("ซ่อมกับเราใน 4 ขั้นตอน", "How a repair works")}</h2>
                <ol className="how-list">
                    {steps.map((s, i) => (
                        <li key={s.en}>
                            <span className="how-num num">{i + 1}</span>
                            <h3>{L(s.th, s.en)}</h3>
                            <p className="muted">{L(s.dth, s.den)}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="home-section visit" aria-labelledby="visit">
                <div className="visit-card">
                    <h2 id="visit">{L("แวะมาที่ร้าน", "Visit the shop")}</h2>
                    <ul className="visit-facts">
                        <li><Icon.Clock /><span>{L("ทุกวัน 09:00–17:00 (พัก 12:00–13:00)", "Daily 09:00–17:00 (lunch 12:00–13:00)")}</span></li>
                        <li><Icon.Pin /><span>{L("123 ถ.พหลโยธิน แขวงจตุจักร กรุงเทพฯ 10900", "123 Phahonyothin Rd, Chatuchak, Bangkok 10900")}</span></li>
                        <li><Icon.Phone /><a href="tel:021234567">02-123-4567</a></li>
                    </ul>
                </div>
                <div className="track-card">
                    <h2>{L("ส่งเครื่องไว้กับเราแล้ว?", "Already left a device with us?")}</h2>
                    <p className="muted">{L("เข้าสู่ระบบเพื่อดูผลตรวจ อนุมัติใบเสนอราคา และชำระเงินได้จากมือถือ", "Sign in to see the diagnosis, approve the quotation and pay from your phone.")}</p>
                    <Link to="/my/repairs" className="btn btn-primary">{L("ติดตามงานซ่อม", "Track my repair")}</Link>
                </div>
            </section>
        </div>
    );
}
