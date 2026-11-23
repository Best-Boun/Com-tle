/**
 * Text that the services write in one language only, shown in the language the
 * user picked. The services are not changed: the page rebuilds the text from
 * the stable parts (notification type, option kind, known history notes).
 * Anything not recognised is shown as the server wrote it.
 */

const woNumber = (text) => String(text || "").match(/WO-[\w-]+/)?.[0] || "";
const firstNumber = (text) => String(text || "").match(/\d+/)?.[0] || "";

/** Repair-Service notifications are stored in Thai; English is rebuilt from `type`. */
export function notificationText(n, lang) {
    if (lang === "th") return { title: n.title, message: n.message };
    const wo = woNumber(n.title);
    const days = firstNumber(n.message);
    const en = {
        RECEIVED: [`Device received ${wo}`, "We have your device. A technician will check it and send you priced options to choose from on the website."],
        QUOTATION_SENT: [`Results ready, choose an option ${wo}`, "The technician has checked your device. Read the results and choose an option on the repair page; we start once you choose."],
        WAITING_PARTS: [`Waiting for parts ${wo}`, "We have ordered parts for your device and will start the repair as soon as they arrive."],
        READY_FOR_PICKUP: [`Ready for pickup ${wo}`, `Collect your device at the shop. We keep it for free for ${days || 7} days.`],
        HANDED_OVER: [`Device collected ${wo}`, /รับประกัน|warranty/i.test(n.message || "")
            ? `Thank you. This repair has a ${days || 90}-day warranty; if the same fault comes back, contact us free of charge.`
            : "Thank you for using SmartFix."],
        CLAIM_OPENED: [`Warranty claim opened ${wo}`, "We have your device for the warranty claim. Claims are free of charge."],
        CANCELLED: [`Repair cancelled ${wo}`, "This repair was cancelled. Contact the shop to collect your device or ask for details."]
    }[n.type];
    return en ? { title: en[0].trim(), message: en[1] } : { title: n.title, message: n.message };
}

/**
 * Options the system adds to every quotation ("no repair", "skip the extra
 * work") are written in Thai by Repair-Service and the demo backend.
 */
export function optionText(option, lang) {
    if (lang === "th" || !option) return { title: option?.title, description: option?.description };
    if (option.kind === "NO_REPAIR") {
        const fee = firstNumber(option.description);
        return {
            title: "No repair, return the device",
            description: /เคลม/.test(option.description || "")
                ? "Warranty claim: no charge."
                : `Checking is free if you repair; choosing not to repair costs a ${fee || 300} THB inspection fee.`
        };
    }
    if (option.kind === "SKIP_EXTRA") {
        return { title: "Skip the extra work", description: "The approved repair goes on with no extra cost." };
    }
    return { title: option.title, description: option.description };
}

/** System line items: the inspection fee of "no repair". */
export function itemText(description, lang) {
    if (lang !== "th" && description === "ค่าตรวจเช็ก (ไม่ซ่อม)") return "Inspection fee (no repair)";
    return description;
}

/**
 * Status-history notes. Repair-Service writes them in English, the demo
 * backend in Thai; each known note is shown in the chosen language.
 * [pattern, Thai, English] — $1 refers to the first group.
 */
const NOTES = [
    [/^(?:Device received|รับเครื่อง)$/, "รับเครื่องแล้ว", "Device received"],
    [/^Walk-in device received$/, "รับเครื่อง walk-in", "Walk-in device received"],
    [/^(?:รับเครื่องจากการจอง|รับเครื่องจากคำขอ) ?(\S*)$/, "รับเครื่องจากคำขอแจ้งซ่อม $1", "Received from repair request $1"],
    [/^Diagnosis started$/, "เริ่มตรวจเช็ก", "Diagnosis started"],
    [/^Quotation Rev\.(\d+) sent with (\d+) options$/, "ส่งตัวเลือก $2 แบบ Rev.$1", "Sent $2 options (Rev.$1)"],
    [/^ส่งตัวเลือก (\d+) แบบ Rev\.(\d+)$/, "ส่งตัวเลือก $1 แบบ Rev.$2", "Sent $1 options (Rev.$2)"],
    [/^เลือก “(.+)” Rev\.(\d+)$/, "เลือก “$1” Rev.$2", "Chose “$1” (Rev.$2)"],
    [/^Option (\d+) "(.+)" chosen on Rev\.(\d+)$/, "เลือกตัวเลือก $1 “$2” Rev.$3", "Chose option $1 “$2” (Rev.$3)"],
    [/^Option (\d+) "(.+)" chosen on Rev\.(\d+): (.+)$/, "เลือกตัวเลือก $1 “$2” Rev.$3: $4", "Chose option $1 “$2” (Rev.$3): $4"],
    [/^Repair completed; testing started$/, "ซ่อมเสร็จ เริ่มทดสอบ", "Repair completed; testing started"],
    [/^(?:Test passed|ทดสอบผ่าน)$/, "ทดสอบผ่าน", "Test passed"],
    [/^(?:Test failed; repair resumed|ทดสอบไม่ผ่าน กลับไปซ่อม)$/, "ทดสอบไม่ผ่าน กลับไปซ่อม", "Test failed; repair resumed"],
    [/^อะไหล่มาแล้ว เริ่มซ่อม$/, "อะไหล่มาแล้ว เริ่มซ่อม", "Parts arrived; repair started"],
    [/^(?:Warranty claim for|เคลมประกันจาก) (\S+)$/, "เคลมประกันจาก $1", "Warranty claim for $1"],
    [/^มอบหมายให้ (.+?)( \(รับงานจากคิว\))?$/, "มอบหมายให้ $1$2", "Assigned to $1"],
    [/^(.+) รับงานจากคิว$/, "$1 รับงานจากคิว", "$1 took the job from the queue"],
    [/^No device brought in within (\d+) days$/, "ไม่มีการนำเครื่องมาภายใน $1 วัน", "No device brought in within $1 days"],
    [/^Deposit feature removed$/, "ยกเลิกระบบมัดจำ", "Deposit feature removed"]
];

export function noteText(note, lang) {
    if (!note) return note;
    for (const [pattern, th, en] of NOTES) {
        if (pattern.test(note)) return note.replace(pattern, lang === "th" ? th : en).trim();
    }
    return note;
}

/**
 * Device types: repair requests send codes, the walk-in form and old data
 * store Thai words. Shown in the chosen language either way.
 */
const DEVICES = {
    NOTEBOOK: ["โน้ตบุ๊ก", "Notebook"],
    "โน้ตบุ๊ก": ["โน้ตบุ๊ก", "Notebook"],
    DESKTOP: ["คอมพิวเตอร์ตั้งโต๊ะ (PC)", "Desktop PC"],
    PC: ["PC", "PC"],
    ALL_IN_ONE: ["All-in-One", "All-in-One"],
    OTHER: ["อื่น ๆ", "Other"],
    "อื่น ๆ": ["อื่น ๆ", "Other"]
};

export function deviceTypeText(value, lang) {
    const pair = DEVICES[value];
    return pair ? pair[lang === "th" ? 0 : 1] : value;
}
