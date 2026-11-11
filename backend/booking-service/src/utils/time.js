/**
 * Date/time helpers for the shop's time zone.
 * The API speaks shop-local "YYYY-MM-DD" + "HH:MM"; the database stores UTC.
 */
function partsInTimezone(timezone, instant) {
    return Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        })
            .formatToParts(instant)
            .map((part) => [part.type, part.value])
    );
}

function nowInTimezone(timezone, now = new Date()) {
    const p = partsInTimezone(timezone, now);
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Shop-local date + time -> UTC Date. */
function zonedToUtc(date, time, timezone) {
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const wallClockAsUtc = Date.UTC(y, m - 1, d, hh, mm);

    // Offset of the zone at (approximately) that moment; repeat once for DST edges.
    let guess = wallClockAsUtc;
    for (let i = 0; i < 2; i += 1) {
        const p = partsInTimezone(timezone, new Date(guess));
        const shownAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
        guess = wallClockAsUtc - (shownAsUtc - guess);
    }
    return new Date(guess);
}

/** UTC Date -> shop-local { date, time }. */
function utcToZoned(instant, timezone) {
    return nowInTimezone(timezone, instant instanceof Date ? instant : new Date(instant));
}

function addDays(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function isValidDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }
    const value = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

/** UTC range [start, end) covering one shop-local day. */
function dayRangeUtc(date, timezone) {
    return {
        start: zonedToUtc(date, "00:00", timezone),
        end: zonedToUtc(addDays(date, 1), "00:00", timezone)
    };
}

module.exports = {
    nowInTimezone,
    zonedToUtc,
    utcToZoned,
    addDays,
    isValidDate,
    dayRangeUtc
};
