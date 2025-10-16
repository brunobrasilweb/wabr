"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
    await app.listen(port);
    console.log(`Server listening on http://localhost:${port}`);
}
bootstrap().catch((err) => {
    console.error('Failed to bootstrap application', err);
    process.exit(1);
});
