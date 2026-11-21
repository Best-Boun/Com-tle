import { deviceTypeText } from "./serverText.js";

/**
 * Labels for repair-request codes. Old bookings stored the device type as free
 * text (e.g. "โน้ตบุ๊ก"), so anything without a dictionary entry is shown as is.
 */
function labelOr(t, key, raw) {
    if (!raw) return "";
    const label = t(key);
    return label === key ? raw : label;
}

export const deviceLabel = (t, deviceType) => {
    const label = t(`device.${deviceType}`);
    if (label !== `device.${deviceType}`) return label;
    // Old bookings stored Thai words ("โน้ตบุ๊ก"); show them in the current language.
    return deviceTypeText(deviceType, t("device.NOTEBOOK") === "Notebook" ? "en" : "th") || "";
};
export const symptomLabel = (t, group) => labelOr(t, `symptom.${group}`, group);

/** "Notebook · Asus · VivoBook 15" */
export function deviceLine(t, r) {
    return [deviceLabel(t, r.device_type), r.brand, r.model].filter(Boolean).join(" · ");
}
