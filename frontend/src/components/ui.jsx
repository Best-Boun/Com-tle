import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { TONES } from "../i18n/dictionary.js";
import { errorText } from "../utils/errors.js";

/* ---------------- Status badge / stamp ---------------- */
export function StatusBadge({ kind, status }) {
    const { t } = useI18n();
    const tone = TONES[kind]?.[status] || "grey";
    return <span className={`badge tone-${tone}`}>{t(`status.${kind}.${status}`)}</span>;
}

export function Stamp({ kind, status, className = "" }) {
    const { t } = useI18n();
    const tone = TONES[kind]?.[status] || "grey";
    return <span className={`stamp tone-${tone} ${className}`}>{t(`status.${kind}.${status}`)}</span>;
}

/* ---------------- Page states ---------------- */
export function Loading() {
    const { t } = useI18n();
    return <p className="muted" role="status">{t("common.loading")}</p>;
}

export function ErrorNotice({ error, onRetry }) {
    const { lang, t } = useI18n();
    if (!error) return null;
    return (
        <div className="notice error" role="alert">
            <div className="stack" style={{ gap: 8 }}>
                <span>{errorText(error, lang)}</span>
                {onRetry && (
                    <div>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>{t("common.retry")}</button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function Empty({ title, children, action }) {
    return (
        <div className="empty">
            <h3>{title}</h3>
            {children && <p className="muted">{children}</p>}
            {action}
        </div>
    );
}

export function PageHead({ title, lede, actions }) {
    return (
        <div className="page-head">
            <div>
                <h1>{title}</h1>
                {lede && <p>{lede}</p>}
            </div>
            {actions && <div className="btn-row">{actions}</div>}
        </div>
    );
}

/* ---------------- Form field ---------------- */
export function Field({ label, hint, error, children, htmlFor }) {
    return (
        <div className="field">
            <label className="field-label" htmlFor={htmlFor}>{label}</label>
            {children}
            {hint && !error && <span className="field-hint">{hint}</span>}
            {error && <span className="field-error">{error}</span>}
        </div>
    );
}

/** Input with its own id wiring. */
export function TextField({ label, hint, error, as = "input", ...props }) {
    const id = useId();
    const Tag = as;
    const cls = as === "textarea" ? "textarea" : as === "select" ? "select" : "input";
    return (
        <Field label={label} hint={hint} error={error} htmlFor={id}>
            <Tag id={id} className={cls} {...props} />
        </Field>
    );
}

/* ---------------- Modal ---------------- */
export function Modal({ title, onClose, children, footer, wide = false }) {
    const { t } = useI18n();
    const ref = useRef(null);
    const titleId = useId();

    useEffect(() => {
        const previous = document.activeElement;
        const first = ref.current?.querySelector("input, select, textarea, button:not([data-close])");
        (first || ref.current)?.focus();
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            previous?.focus?.();
        };
    }, [onClose]);

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} style={wide ? { width: "min(760px, 100%)" } : undefined}>
                <div className="modal-head">
                    <h2 id={titleId} style={{ fontSize: "var(--fs-lg)" }}>{title}</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} data-close aria-label={t("common.close")}>✕</button>
                </div>
                {children}
                {footer && <div className="modal-foot">{footer}</div>}
            </div>
        </div>
    );
}

/* ---------------- Toasts ---------------- */
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const push = useCallback((message, tone = "ok") => {
        const id = Math.random().toString(36).slice(2);
        setToasts((list) => [...list, { id, message, tone }]);
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 3200);
    }, []);
    return (
        <ToastContext.Provider value={push}>
            {children}
            <div className="toasts" aria-live="polite">
                {toasts.map((x) => (
                    <div key={x.id} className={`toast ${x.tone === "error" ? "error" : ""}`}>{x.message}</div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}

/**
 * Run an API action with busy state, success toast and localized error toast.
 * Returns [run, busy].
 */
export function useAction() {
    const toast = useToast();
    const { lang } = useI18n();
    const [busy, setBusy] = useState(false);
    const run = useCallback(async (fn, successMessage) => {
        setBusy(true);
        try {
            const result = await fn();
            if (successMessage) toast(successMessage);
            return result;
        } catch (error) {
            toast(errorText(error, lang), "error");
            throw error;
        } finally {
            setBusy(false);
        }
    }, [toast, lang]);
    return [run, busy];
}

/* ---------------- Money helpers ---------------- */
export function Money({ value, currency = "THB" }) {
    const { fmt } = useI18n();
    return <span className="num">{fmt.money(value, currency)}</span>;
}
