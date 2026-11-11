/* Small stroke icons for the staff sidebar (24px grid, currentColor). */
const base = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
};

export const Icon = {
    Dashboard: () => (<svg {...base}><path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z" /></svg>),
    Calendar: () => (<svg {...base}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>),
    Wrench: () => (<svg {...base}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></svg>),
    Tag: () => (<svg {...base}><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></svg>),
    Box: () => (<svg {...base}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>),
    Cash: () => (<svg {...base}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v.01M18 15v.01" /></svg>),
    Clipboard: () => (<svg {...base}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12h6M9 16h4" /></svg>),
    User: () => (<svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>),
    Menu: () => (<svg {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>),
    Logout: () => (<svg {...base}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></svg>),
    Globe: () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>)
};

/** Brand mark: a repair tag. */
export function BrandMark({ light = false }) {
    return (
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 4h16l6 6v18H6z" fill={light ? "#ffffff" : "#16624A"} />
            <circle cx="12" cy="10" r="2.5" fill={light ? "#17212B" : "#EEF1EF"} />
            <path d="M11 18h10M11 22h7" stroke={light ? "#17212B" : "#EEF1EF"} strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}
