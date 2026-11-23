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
    code: "CSI400",
    name: "Web Services",        // course name
    university: "Sripatum University (SPU)",
    year: "2026"
};

export const INSTRUCTOR = {
    name: "อาจารย์ ทินภัทร บริรักษ์",
    name_en: "Thinnaphat Borirak",
    title: "อาจารย์ผู้สอน",
    title_en: "Course instructor",
    department: "Department of Computer Science and Software Development Innovation",
    email: "thinnaphat.bo@spu.ac.th",
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
        role: "Tester & Developer",
        module: "Booking Service & Catalog Service",
        services: ["Booking Service", "Catalog Service"],
        github: "Siwakorn1-ai",
        photo: "/team/siwakorn.jpg",
        lead: false
    },
    {
        name: "นาย สุรวุฒิ บุญยู้",
        name_en: "Surawut Boonyu",
        student_id: "67144643",
        role: "Lead Developer",
        module: "Repair Service & Inventory Service",
        services: ["Repair Service", "Inventory Service"],
        github: "Best-Boun",
        photo: "/team/stdempimg.gif",
        lead: true
    },
    {
        name: "นาย รัชภูมิ ธรรมประชา",
        name_en: "Rachapoom Thumpracha",
        student_id: "67159224",
        role: "System Analyst & Developer",
        module: "User Service & Payment Service",
        services: ["User Service", "Payment Service"],
        github: "rachapoomthu-max",
        photo: "/team/Rachapoom.gif",
        lead: false
    }
];
