/**
 * Who built SmartFix: shown on the /team page and repeated in README.md
 * ("ผู้พัฒนา / Developers"). Edit only this file to change the page.
 *
 * Empty strings show as "รอใส่ข้อมูล / to be added" on the page.
 * photo: optional image path under frontend/public, e.g. "/team/somchai.jpg";
 *        without it the card shows the person's initials.
 * github: username only, e.g. "octocat". name_en: the name in English.
 */

export const COURSE = {
    code: "",        // e.g. "CSI400"
    name: "",        // course name
    university: "",  // e.g. "มหาวิทยาลัยศรีปทุม (SPU)"
    year: "2026"
};

export const INSTRUCTOR = {
    name: "",
    title: "อาจารย์ผู้สอน",
    department: "",
    email: "",
    photo: ""
};

/**
 * One entry per member. lead: true marks the team lead (one person).
 * services: what this person built, shown as tags.
 */
export const MEMBERS = [
    {
        name: "นาย ศิวากร แทนทรัพย์",
        name_en: "Siwakorn Thaensap",
        student_id: "67128056",
        role: "",       // e.g. "System Analyst & Developer"
        module: "",     // e.g. "Repair Request & Warranty"
        services: [],   // e.g. ["Booking Service", "Warranty"]
        github: "Siwakorn1-ai",
        photo: "",
        lead: false
    },
    {
        name: "นาย สุรวุฒิ บุญยู้",
        name_en: "Surawut Boonyu",
        student_id: "67144643",
        role: "",       // e.g. "System Analyst & Developer"
        module: "",     // e.g. "Repair Request & Warranty"
        services: [],   // e.g. ["Booking Service", "Warranty"]
        github: "Best-Boun",
        photo: "",
        lead: false
    },
    {
        name: "นาย รัชภูมิ ธรรมประชา",
        name_en: "Rachapoom Thumpracha",
        student_id: "67159224",
        role: "",       // e.g. "System Analyst & Developer"
        module: "",     // e.g. "Repair Request & Warranty"
        services: [],   // e.g. ["Booking Service", "Warranty"]
        github: "rachapoomthu-max",
        photo: "",
        lead: false
    }
];
