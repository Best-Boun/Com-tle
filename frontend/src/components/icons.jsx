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
    Users: () => (<svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></svg>),
    User: () => (<svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>),
    Menu: () => (<svg {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>),
    Logout: () => (<svg {...base}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></svg>),
    Globe: () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>),
    /* Devices and service categories */
    Laptop: () => (<svg {...base}><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>),
    Desktop: () => (<svg {...base}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M9 20h6M12 16v4" /></svg>),
    Tower: () => (<svg {...base}><rect x="7" y="3" width="10" height="18" rx="1.5" /><path d="M10 7h4M10 10h4" /><circle cx="12" cy="16" r="1.2" /></svg>),
    Fan: () => (<svg {...base}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="1.5" /><path d="M12 10.5c0-3 1-5 3-5.5M13.5 12c3 0 5 1 5.5 3M12 13.5c0 3-1 5-3 5.5M10.5 12c-3 0-5-1-5.5-3" /></svg>),
    Shield: () => (<svg {...base}><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>),
    Chip: () => (<svg {...base}><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></svg>),
    Memory: () => (<svg {...base}><rect x="2" y="7" width="20" height="9" rx="1" /><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 16v3M19 16v3" /></svg>),
    Check: () => (<svg {...base}><path d="m5 12 4 4 10-10" /></svg>),
    Clock: () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
    Pin: () => (<svg {...base}><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>),
    Phone: () => (<svg {...base}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>),
    Search: () => (<svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>),
    Arrow: () => (<svg {...base}><path d="M5 12h14M13 6l6 6-6 6" /></svg>),
    Bell: () => (<svg {...base}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>)
};

/** Category code -> icon. Unknown codes fall back to a wrench. */
export function CategoryIcon({ code }) {
    const map = { MAINTENANCE: Icon.Fan, SOFTWARE: Icon.Shield, REPAIR: Icon.Chip, UPGRADE: Icon.Memory };
    const Cmp = map[code] || Icon.Wrench;
    return <Cmp />;
}

/** Brand mark: a repair tag. */
export function BrandMark({ light = false }) {
    return (
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="3" y="3" width="26" height="26" rx="6" fill={light ? "#12805B" : "#0C3B2D"} />
            <path d="M9 22v-5h6l3-3h5" fill="none" stroke="#E4924A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="23" cy="14" r="2.2" fill="#E4924A" />
            <circle cx="9" cy="22" r="2.2" fill="#ffffff" />
            <path d="M9 10h8" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}
