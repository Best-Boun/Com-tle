/**
 * Sample categories and services for development. Safe to re-run.
 * Prices are in whole baht.
 */
const categories = [
    { category_id: "5a0c0000-0000-4000-8000-000000000001", category_code: "MAINTENANCE", category_name: "Maintenance", description: "ดูแลรักษาเครื่อง" },
    { category_id: "5a0c0000-0000-4000-8000-000000000002", category_code: "SOFTWARE", category_name: "Software", description: "ติดตั้งและแก้ปัญหาซอฟต์แวร์" },
    { category_id: "5a0c0000-0000-4000-8000-000000000003", category_code: "REPAIR", category_name: "Hardware Repair", description: "ตรวจเช็กและซ่อมฮาร์ดแวร์" }
];

const services = [
    {
        service_id: "6f1c2a10-0000-4000-8000-000000000001",
        category_id: categories[0].category_id,
        service_code: "PC-CLEAN",
        service_name: "PC Cleaning",
        description: "ทำความสะอาดภายในเครื่อง เปลี่ยนซิลิโคน CPU/GPU",
        starting_price: 500,
        estimated_duration_minutes: 60
    },
    {
        service_id: "6f1c2a10-0000-4000-8000-000000000002",
        category_id: categories[1].category_id,
        service_code: "OS-INSTALL",
        service_name: "OS Installation",
        description: "ติดตั้งระบบปฏิบัติการและไดรเวอร์",
        starting_price: 400,
        estimated_duration_minutes: 90
    },
    {
        service_id: "6f1c2a10-0000-4000-8000-000000000003",
        category_id: categories[2].category_id,
        service_code: "HW-DIAG",
        service_name: "Hardware Diagnosis",
        description: "ตรวจเช็กอาการเสียของฮาร์ดแวร์ก่อนเสนอราคาซ่อม",
        starting_price: 300,
        estimated_duration_minutes: 60
    },
    {
        service_id: "6f1c2a10-0000-4000-8000-000000000004",
        category_id: categories[2].category_id,
        service_code: "NB-SCREEN",
        service_name: "Notebook Screen Replacement",
        description: "เปลี่ยนจอโน้ตบุ๊ก (ราคาเริ่มต้น ไม่รวมค่าอะไหล่)",
        starting_price: 800,
        estimated_duration_minutes: 120
    }
];

exports.seed = async function seed(knex) {
    await knex("service_categories").insert(categories).onConflict("category_code").ignore();
    await knex("services").insert(services).onConflict("service_code").ignore();
};
