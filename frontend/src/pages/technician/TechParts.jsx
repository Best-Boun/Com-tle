import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { api } from "../../api/index.js";
import { useAsync } from "../../utils/useAsync.js";
import { ErrorNotice, Loading, Money, PageHead } from "../../components/ui.jsx";

export default function TechParts() {
    const { L, t } = useI18n();
    const [q, setQ] = useState("");
    const parts = useAsync(() => api.inventory.listParts(), []);
    const items = (parts.data || []).filter((p) => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()));
    return (
        <div>
            <PageHead title={L("อะไหล่ในร้าน", "Parts in stock")} lede={L("ดูของที่มีก่อนเสนอรายการซ่อม การเบิกจริงทำโดยผู้ดูแลร้านหลังลูกค้าอนุมัติ", "Check availability before proposing items. Parts are issued by the admin after approval.")} />
            <input className="input" style={{ maxWidth: 320, marginBottom: 16 }} type="search" placeholder={L("ค้นหาอะไหล่", "Search parts")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            {parts.loading && <Loading />}
            <ErrorNotice error={parts.error} onRetry={parts.reload} />
            {parts.data && (
                <div className="table-wrap">
                    <table className="table">
                        <thead><tr><th>SKU</th><th>{L("ชื่อ", "Name")}</th><th className="right">{L("ราคาขาย", "Price")}</th><th className="right">{L("คงเหลือ", "In stock")}</th></tr></thead>
                        <tbody>
                            {items.map((p) => (
                                <tr key={p.part_id}>
                                    <td className="num faint">{p.sku}</td>
                                    <td>{p.name}</td>
                                    <td className="right"><Money value={p.unit_price} /></td>
                                    <td className="right num">{p.stock === 0 ? <span className="badge tone-red">{L("หมด", "Out")}</span> : p.stock <= p.reorder_level ? <span className="badge tone-amber">{p.stock}</span> : p.stock}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
