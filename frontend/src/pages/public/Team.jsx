import { useI18n } from "../../i18n/I18nProvider.jsx";
import { PageHead } from "../../components/ui.jsx";
import { COURSE, INSTRUCTOR, MEMBERS } from "../../data/team.js";
import "./team.css";

/** "Somchai Jaidee" -> "SJ"; Thai names give their first two letters. */
function initials(name) {
    // Thai titles are not part of the name.
    const parts = name.trim().replace(/^(นาย|นางสาว|นาง)\s*/, "").split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (/^[A-Za-z]/.test(parts[0])) return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
    return [...parts[0].replace(/[ัิ-ฺ็-๎]/g, "")].slice(0, 2).join("");
}

function Avatar({ name, photo, size = 64 }) {
    return photo
        ? <img className="team-avatar" src={photo} alt="" width={size} height={size} />
        : <span className="team-avatar team-avatar-initials" style={{ width: size, height: size }} aria-hidden="true">{initials(name)}</span>;
}

function GitHubIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
    );
}

export default function Team() {
    const { L } = useI18n();
    const missing = L("รอใส่ข้อมูล", "To be added");
    const show = (value) => (value && String(value).trim()) || missing;
    // Team lead first, then the order in data/team.js.
    const members = [...MEMBERS].sort((a, b) => Number(Boolean(b.lead)) - Number(Boolean(a.lead)));
    const course = [COURSE.code, COURSE.name].filter(Boolean).join(" · ");

    return (
        <div className="stack-lg team-page">
            <PageHead
                title={L("ทีมผู้พัฒนา", "The team behind SmartFix")}
                lede={L(
                    `SmartFix ระบบรับซ่อมคอมพิวเตอร์และโน้ตบุ๊กแบบ microservices พัฒนาโดยสมาชิก ${MEMBERS.length} คน แต่ละคนรับผิดชอบส่วนหนึ่งของระบบ`,
                    `SmartFix, a microservice repair-shop system for computers and notebooks, built by ${MEMBERS.length} members who each own part of the system.`
                )}
            />

            <section className="team-instructor" aria-label={L("อาจารย์ผู้สอน", "Course instructor")}>
                <Avatar name={INSTRUCTOR.name || "?"} photo={INSTRUCTOR.photo} size={80} />
                <div className="team-instructor-body">
                    <span className="badge tone-green">{show(INSTRUCTOR.title)}{course ? ` · ${course}` : ""}</span>
                    <h2>{show(INSTRUCTOR.name)}</h2>
                    <p className="small muted">{show(INSTRUCTOR.department)}</p>
                    {COURSE.university && <p className="small"><strong>{COURSE.university}</strong></p>}
                </div>
                {INSTRUCTOR.email && <a className="btn btn-secondary btn-sm team-instructor-mail" href={`mailto:${INSTRUCTOR.email}`}>{INSTRUCTOR.email}</a>}
            </section>

            <ul className="team-grid" aria-label={L("สมาชิก", "Members")}>
                {members.map((m, i) => (
                    <li key={m.student_id || i} className={`team-card ${m.lead ? "team-card-lead" : ""}`}>
                        <div className="team-card-top">
                            <Avatar name={m.name_en || m.name || "?"} photo={m.photo} />
                            {m.lead && <span className="badge tone-amber">{L("หัวหน้าทีม", "Team lead")}</span>}
                        </div>
                        <h3>{show(m.name)}</h3>
                        {m.name_en && <p className="small">{m.name_en}</p>}
                        <p className="num small faint">{show(m.student_id)}</p>
                        <p className="team-role">{show(m.role)}</p>
                        <div className="team-module">
                            <span className="team-module-label">{L("ส่วนที่รับผิดชอบ", "Owns")}</span>
                            <strong>{show(m.module)}</strong>
                        </div>
                        {m.services?.length > 0 && (
                            <ul className="team-tags">
                                {m.services.map((s) => <li key={s}>{s}</li>)}
                            </ul>
                        )}
                        {m.github && (
                            <a className="team-github" href={`https://github.com/${m.github}`} target="_blank" rel="noreferrer">
                                <GitHubIcon />@{m.github}
                            </a>
                        )}
                    </li>
                ))}
            </ul>

            <p className="small faint">
                {L(
                    `ซอร์สโค้ดเผยแพร่ภายใต้สัญญาอนุญาต MIT · © ${COURSE.year} SmartFix development team`,
                    `Source code released under the MIT License · © ${COURSE.year} SmartFix development team`
                )}
            </p>
        </div>
    );
}
