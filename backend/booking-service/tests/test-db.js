const db = require("../src/config/database");

async function testConnection() {
    try {
        const rows = await db("information_schema.SCHEMATA")
            .select("SCHEMA_NAME")
            .where("SCHEMA_NAME", process.env.DB_NAME);

        if (rows.length > 0) {
            console.log("Database connection successful!");
            console.log("Connected to database:", rows[0].SCHEMA_NAME);
        } else {
            console.log("Connected, but database was not found.");
        }
    } catch (error) {
        console.error("Database connection failed:");
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        await db.destroy();
    }
}

testConnection();