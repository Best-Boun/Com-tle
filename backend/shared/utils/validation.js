const AppError = require("../errors/AppError");

/**
 * Validate input with a zod schema (schema passed in, so /shared needs no zod).
 * Throws a 400 AppError naming the first invalid field.
 */
function parseOrThrow(schema, input, message = "Invalid request") {
    const result = schema.safeParse(input);
    if (result.success) {
        return result.data;
    }

    const issue = result.error.issues[0];
    const field = issue?.path?.length ? issue.path.join(".") : null;
    const detail = field ? `${field}: ${issue.message}` : issue?.message;
    throw new AppError(detail ? `${message} (${detail})` : message, 400);
}

module.exports = {
    parseOrThrow
};
