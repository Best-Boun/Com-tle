require("dotenv").config();
const { loadGatewayConfig } = require("./src/config/gatewayConfig");
const { createGatewayApp } = require("./src/app");
const PORT = process.env.PORT || 3000;
const config = loadGatewayConfig();
const app = createGatewayApp(config);

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
