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
            database: process.env.DB_NAME
        },

        pool: {
            min: Number(process.env.DB_POOL_MIN || 0),
            max: Number(process.env.DB_POOL_MAX || 5)
        },

        migrations: {
            directory: "./migrations",
            tableName: "knex_migrations"
        },

        seeds: {
            directory: "./seeds"
        }
    },

    test: {
        client: "mysql2",

        connection: {
            host: process.env.DB_TEST_HOST,
            port: Number(process.env.DB_TEST_PORT),
            user: process.env.DB_TEST_USER,
            password: process.env.DB_TEST_PASSWORD,
            database: process.env.DB_TEST_NAME
        },

        pool: {
            min: 0,
            max: 1
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