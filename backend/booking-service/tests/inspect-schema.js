// Read-only: prints every table in this service's database (DB_NAME in .env)
const db = require("../src/config/database");

async function main() {
    try {
        const [tables] = await db.raw("SHOW TABLES");
        console.log(`Database: ${process.env.DB_NAME} (${tables.length} tables)\n`);
        for (const row of tables) {
            const name = Object.values(row)[0];
            const [[create]] = await db.raw(`SHOW CREATE TABLE \`${name}\``);
            const [[{ total }]] = await db.raw(`SELECT COUNT(*) AS total FROM \`${name}\``);
            console.log(`-- ${name}: ${total} rows`);
            console.log(create["Create Table"] + ";\n");
        }
    } catch (error) {
        console.error("Failed:", error.message);
        process.exitCode = 1;
    } finally {
        await db.destroy();
    }
}

main();
