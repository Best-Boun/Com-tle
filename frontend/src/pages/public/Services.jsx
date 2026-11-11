import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead } from "../../components/ui.jsx";
import "./home.css";

export default function Services() {
    const { L, t } = useI18n();
    const [category, setCategory] = useState("");
    const [search, setSearch] = useState("");
    const data = useAsync(async () => {
        const [categories, services] = await Promise.all([api.catalog.listCategories(), api.catalog.listServices()]);
        return { categories, services };
    }, []);

    const groups = useMemo(() => {
        if (!data.data) return [];
        const q = search.trim().toLowerCase();
        return data.data.categories
            .filter((c) => !category || c.category_id === category)
            .map((c) => ({
                ...c,
                services: data.data.services.filter((s) => s.category_id === c.category_id && (!q || s.service_name.toLowerCase().includes(q)))
            }))
            .filter((g) => g.services.length > 0);
    }, [data.data, category, search]);

    return (
        <div>
            <PageHead
                title={L("บริการและราคา", "Services & prices")}
                lede={L("ราคาเริ่มต้นเป็นค่าแรง ราคาจริงจะแจ้งในใบเสนอราคาหลังช่างตรวจเครื่อง", "Starting prices cover labour. You get an exact quotation after we check your device.")}
            />
            {data.loading && <Loading />}
            <ErrorNotice error={data.error} onRetry={data.reload} />
            {data.data && (
                <div className="stack-lg">
                    <div className="cluster">
                        <div className="tabs" role="tablist" aria-label={L("หมวดหมู่", "Categories")}>
                            <button type="button" role="tab" className="tab" aria-selected={category === ""} onClick={() => setCategory("")}>{t("common.all")}</button>
                            {data.data.categories.map((c) => (
                                <button key={c.category_id} type="button" role="tab" className="tab" aria-selected={category === c.category_id} onClick={() => setCategory(c.category_id)}>
                                    {c.category_name}
                                </button>
                            ))}
                        </div>
                        <input
                            className="input"
                            style={{ maxWidth: 260 }}
                            type="search"
                            placeholder={L("ค้นหาบริการ", "Search services")}
                            aria-label={t("common.search")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    {groups.length === 0 && <p className="muted">{L("ไม่พบบริการที่ค้นหา", "No services match your search.")}</p>}

                    {groups.map((g) => (
                        <section key={g.category_id} className="stack">
                            <div>
                                <h2>{g.category_name}</h2>
                                {g.description && <p className="muted small">{g.description}</p>}
                            </div>
                            <ul className="service-rows">
                                {g.services.map((s) => (
                                    <li key={s.service_id}>
                                        <div className="service-main">
                                            <h3>{s.service_name}</h3>
                                            {s.description && <p className="muted small">{s.description}</p>}
                                            <span className="small faint">{L("ใช้เวลาประมาณ", "About")} {s.estimated_duration_minutes} {L("นาที", "min")}</span>
                                        </div>
                                        <div className="service-side">
                                            <span className="num service-price">{L("เริ่ม", "from")} <Money value={s.starting_price} /></span>
                                            <Link to={`/book?service=${s.service_id}`} className="btn btn-secondary btn-sm">{L("จองบริการนี้", "Book this")}</Link>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
