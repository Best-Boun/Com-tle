import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { api } from "../api/index.js";
import { Modal, Money, TextField, useAction } from "./ui.jsx";

/**
 * Online checkout for a customer's approved quotation.
 *
 * MOCKUP: there is no real payment provider. The QR code is decorative and card
 * details never leave the browser (they are not sent to the API). Confirming
 * records the payment straight away, so the work order shows as paid without
 * the shop having to take the payment by hand.
 */

const PROCESSING_MS = 1400;

/** A decorative QR-like grid (not a scannable code), stable per work order. */
function MockQr({ seed, size = 184 }) {
    const cells = 25;
    const grid = useMemo(() => {
        let h = 2166136261;
        for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        const next = () => {
            h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
            return (h >>> 0) / 4294967296;
        };
        const inFinder = (x, y) => [[0, 0], [cells - 7, 0], [0, cells - 7]]
            .some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
        const dots = [];
        for (let y = 0; y < cells; y += 1) {
            for (let x = 0; x < cells; x += 1) {
                if (!inFinder(x, y) && next() > 0.52) dots.push([x, y]);
            }
        }
        return dots;
    }, [seed]);
    const finder = (fx, fy) => (
        <g key={`${fx}-${fy}`}>
            <rect x={fx} y={fy} width="7" height="7" fill="#17212b" />
            <rect x={fx + 1} y={fy + 1} width="5" height="5" fill="#fff" />
            <rect x={fx + 2} y={fy + 2} width="3" height="3" fill="#17212b" />
        </g>
    );
    return (
        <svg viewBox={`-1 -1 ${cells + 2} ${cells + 2}`} width={size} height={size} role="img" aria-label="QR (mock)" style={{ background: "#fff", borderRadius: 8, display: "block" }}>
            {grid.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#17212b" />)}
            {finder(0, 0)}{finder(cells - 7, 0)}{finder(0, cells - 7)}
        </svg>
    );
}

const digits = (value) => value.replace(/\D/g, "");

function formatCardNumber(value) {
    return digits(value).slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatExpiry(value) {
    const d = digits(value).slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

function cardValid(card) {
    const [mm] = card.expiry.split("/");
    return digits(card.number).length === 16
        && card.name.trim().length > 1
        && /^\d{2}\/\d{2}$/.test(card.expiry) && Number(mm) >= 1 && Number(mm) <= 12
        && /^\d{3}$/.test(card.cvc);
}

/**
 * Pays either a work order's outstanding balance (`workOrder`) or any other
 * fixed charge (`charge`: { amount, label, seed, title?, dueAt?, doneNote?,
 * pay(method) -> { reference, at, result } }), e.g. a booking deposit.
 */
export default function Checkout({ workOrder, charge, onClose, onPaid }) {
    const { L, t, fmt } = useI18n();
    const [run] = useAction();
    const [method, setMethod] = useState("PROMPTPAY");
    const [card, setCard] = useState({ number: "", name: "", expiry: "", cvc: "" });
    const [step, setStep] = useState("choose"); // choose | processing | done
    const [paid, setPaid] = useState(null);
    const amount = charge ? charge.amount : workOrder.payment.balance;
    const label = charge ? charge.label : workOrder.work_order_number;
    const seed = charge ? charge.seed : workOrder.work_order_id;

    async function pay() {
        setStep("processing");
        // Pretend to wait for the bank before recording the payment.
        await new Promise((resolve) => setTimeout(resolve, PROCESSING_MS));
        if (charge) {
            const done = await run(() => charge.pay(method)).catch(() => null);
            if (!done) {
                setStep("choose");
                return;
            }
            setPaid({ amount, reference: done.reference || null, at: done.at || new Date().toISOString() });
            setStep("done");
            onPaid(done.result);
            return;
        }
        const updated = await run(() => api.payments.checkout(workOrder.work_order_id, { method })).catch(() => null);
        if (!updated) {
            setStep("choose");
            return;
        }
        const latest = [...(updated.payments || [])]
            .filter((p) => p.type === "PAYMENT")
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        setPaid({ amount, reference: latest?.note || null, at: latest?.created_at || new Date().toISOString() });
        setStep("done");
        onPaid(updated);
    }

    const canPay = method === "PROMPTPAY" || cardValid(card);
    const busy = step === "processing";

    if (step === "done") {
        return (
            <Modal title={L("ชำระเงินสำเร็จ", "Payment successful")} onClose={onClose} footer={(
                <button type="button" className="btn btn-primary" onClick={onClose}>{t("common.close")}</button>
            )}>
                <div className="checkout-done stack">
                    <div className="checkout-check" aria-hidden="true">✓</div>
                    <p className="checkout-amount"><Money value={paid.amount} /></p>
                    <p className="muted small" style={{ textAlign: "center" }}>
                        {label} · {t(`pay.method.${method}`)} · {fmt.dateTime(paid.at)}
                    </p>
                    {paid.reference && <p className="small faint num" style={{ textAlign: "center" }}>{L("เลขอ้างอิง", "Reference")} {paid.reference}</p>}
                    <p className="small" style={{ textAlign: "center" }}>{charge?.doneNote || L("ร้านเห็นยอดชำระแล้วโดยอัตโนมัติ ไม่ต้องแจ้งสลิป", "The shop sees this payment automatically — no need to send a slip.")}</p>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            title={charge?.title || L("ชำระเงินออนไลน์", "Pay online")}
            onClose={busy ? () => {} : onClose}
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
                    <button type="button" className="btn btn-primary" disabled={busy || !canPay} onClick={pay}>
                        {busy
                            ? L("กำลังดำเนินการ…", "Processing…")
                            : method === "PROMPTPAY"
                                ? <>{L("ยืนยันว่าสแกนจ่ายแล้ว", "I've paid")} <Money value={amount} /></>
                                : <>{L("ชำระ", "Pay")} <Money value={amount} /></>}
                    </button>
                </>
            )}
        >
            <div className="stack">
                <div className="checkout-total">
                    <span className="muted small">{L("ยอดที่ต้องชำระ", "Amount due")} · {label}</span>
                    <strong><Money value={amount} /></strong>
                </div>
                {charge?.dueAt && (
                    <p className="small muted" style={{ margin: 0 }}>
                        {L(`กันคิวไว้ให้ถึง ${fmt.time(charge.dueAt)} น. ชำระก่อนเวลานี้เพื่อยืนยันคิว`, `Your slot is held until ${fmt.time(charge.dueAt)}. Pay before then to confirm it.`)}
                    </p>
                )}

                <div className="checkout-tabs" role="tablist" aria-label={L("วิธีชำระเงิน", "Payment method")}>
                    {["PROMPTPAY", "CARD"].map((m) => (
                        <button key={m} type="button" role="tab" aria-selected={method === m} disabled={busy}
                            className={`checkout-tab${method === m ? " is-active" : ""}`} onClick={() => setMethod(m)}>
                            {m === "PROMPTPAY" ? L("พร้อมเพย์ QR", "PromptPay QR") : L("บัตรเครดิต/เดบิต", "Credit/debit card")}
                        </button>
                    ))}
                </div>

                {method === "PROMPTPAY" ? (
                    <div className="checkout-qr">
                        <MockQr seed={seed} />
                        <p className="small muted">{L("สแกนด้วยแอปธนาคาร แล้วกดยืนยันด้านล่าง", "Scan with your banking app, then confirm below.")}</p>
                    </div>
                ) : (
                    <div className="stack">
                        <TextField label={L("หมายเลขบัตร", "Card number")} inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242"
                            value={card.number} disabled={busy} onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })} />
                        <TextField label={L("ชื่อบนบัตร", "Name on card")} autoComplete="off"
                            value={card.name} disabled={busy} onChange={(e) => setCard({ ...card, name: e.target.value })} />
                        <div className="checkout-row">
                            <TextField label={L("วันหมดอายุ", "Expiry")} inputMode="numeric" autoComplete="off" placeholder="MM/YY"
                                value={card.expiry} disabled={busy} onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} />
                            <TextField label="CVC" inputMode="numeric" autoComplete="off" placeholder="123"
                                value={card.cvc} disabled={busy} onChange={(e) => setCard({ ...card, cvc: digits(e.target.value).slice(0, 3) })} />
                        </div>
                    </div>
                )}

                <p className="notice info small" style={{ margin: 0 }}>
                    {L("ระบบจำลอง: ไม่มีการตัดเงินจริง และข้อมูลบัตรไม่ถูกส่งออกจากเครื่อง",
                        "Demo checkout: no real money moves and card details never leave this device.")}
                </p>
            </div>
        </Modal>
    );
}
