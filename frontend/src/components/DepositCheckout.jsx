import { useI18n } from "../i18n/I18nProvider.jsx";
import { api } from "../api/index.js";
import Checkout from "./Checkout.jsx";

export const DEPOSIT_AMOUNT = 200;

/** The ฿200 deposit that confirms a held booking (mock provider, like the checkout). */
export default function DepositCheckout({ booking, onClose, onPaid }) {
    const { L } = useI18n();
    const charge = {
        amount: api.bookings.config.depositAmount || DEPOSIT_AMOUNT,
        label: booking.booking_number,
        seed: booking.booking_id,
        title: L("ชำระมัดจำเพื่อยืนยันคิว", "Pay the deposit to confirm"),
        dueAt: booking.deposit_due_at,
        doneNote: L("ได้คิวแล้ว มัดจำจะหักจากค่าซ่อมเมื่อมาตามนัด ยกเลิกก่อนเวลานัดได้เงินคืนเต็ม", "You're booked. The deposit comes off the repair bill when you come; cancel before the appointment for a full refund."),
        async pay(method) {
            const deposit = await api.payments.payDeposit(booking.booking_id, { method });
            let confirmed;
            try {
                confirmed = await api.bookings.confirmDeposit(booking.booking_id);
            } catch (error) {
                // Paid but the slot could not be kept: the deposit goes back.
                await api.payments.settleDeposit(booking.booking_id).catch(() => null);
                throw error;
            }
            return { reference: deposit.reference_number, at: deposit.paid_at, result: confirmed };
        }
    };
    return <Checkout charge={charge} onClose={onClose} onPaid={onPaid} />;
}

/** "฿200 · held / applied / refunded / kept by the shop" for a deposit, or null. */
export function DepositNote({ deposit }) {
    const { L, t, fmt } = useI18n();
    if (!deposit) return null;
    return (
        <span>
            {L("มัดจำ", "Deposit")} {fmt.money(deposit.amount)} · {t(`deposit.status.${deposit.status}`)}
        </span>
    );
}
