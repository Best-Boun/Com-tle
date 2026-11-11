/** Turn an ApiError (or anything thrown) into text in the current language. */
export function errorText(error, lang) {
    if (!error) return "";
    if (error.localized) return error.localized[lang] || error.localized.en;
    return error.message || (lang === "th" ? "เกิดข้อผิดพลาด" : "Something went wrong");
}
