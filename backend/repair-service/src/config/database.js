const knex = require("knex");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config({
    path: path.resolve(__dirname, "../../.env")
});

// Validate required environment variables
const requiredEnv = [
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME"
];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Missing environment variable: ${key}`);
    }
}

// Create database connection
const db = knex({
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

    acquireConnectionTimeout: 10000
});

module.exports = db;