import { Link } from "react-router-dom";
import { Stamp } from "./ui.jsx";

/**
 * The repair ticket: SmartFix's signature element.
 * Used for bookings and work orders in customer and technician lists.
 */
export default function Ticket({ to, number, title, meta = [], kind, status, stub, walkIn = false }) {
    const Tag = to ? Link : "div";
    return (
        <Tag to={to} className={`ticket ${walkIn ? "walkin" : ""}`}>
            <div className="ticket-tag" aria-hidden="true" />
            <div className="ticket-body">
                <span className="ticket-number">{number}</span>
                <span className="ticket-title">{title}</span>
                {meta.length > 0 && (
                    <div className="ticket-meta">
                        {meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
                    </div>
                )}
            </div>
            <div className="ticket-stub">
                <Stamp kind={kind} status={status} />
                {stub}
            </div>
        </Tag>
    );
}
