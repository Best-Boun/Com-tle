require("dotenv").config({
    path: require("path").resolve(__dirname, ".env")
});

module.exports = {
    development: {
        client: "mysql2",

        connection: {
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            timezone: "Z"
        },

        pool: {
            min: Number(process.env.DB_POOL_MIN || 0),
            max: Number(process.env.DB_POOL_MAX || 5),
            afterCreate(connection, done) {
                connection.query("SET time_zone = '+00:00'", (error) => done(error, connection));
            }
        },

        migrations: {
            directory: "./migrations",
            tableName: "knex_migrations"
        },

        seeds: {
            directory: "./seeds"
        }
    }
};