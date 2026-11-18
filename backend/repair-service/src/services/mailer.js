/**
 * Sends notification emails over SMTP when SMTP_URL is set, e.g.
 *   SMTP_URL=smtps://user:app-password@smtp.gmail.com:465
 *   MAIL_FROM="SmartFix <no-reply@smartfix.test>"
 * Without SMTP_URL nothing is sent: send() reports NOT_CONFIGURED and the
 * message still shows on the website.
 */
function createMailer(env = process.env, { createTransport, logger = console } = {}) {
    const url = env.SMTP_URL?.trim();
    if (!url) {
        return {
            configured: false,
            async send() {
                return "NOT_CONFIGURED";
            }
        };
    }
    const make = createTransport || require("nodemailer").createTransport;
    const transport = make(url);
    const from = env.MAIL_FROM?.trim() || "SmartFix <no-reply@smartfix.local>";
    return {
        configured: true,
        async send({ to, subject, text }) {
            try {
                await transport.sendMail({ from, to, subject, text });
                return "SENT";
            } catch (error) {
                logger.error(`Notification email to ${to} failed: ${error.message}`);
                return "FAILED";
            }
        }
    };
}

module.exports = {
    createMailer
};
