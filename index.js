const { createServer } = require("./src/server");
const { connectDatabase } = require("./src/database");

const config = require("./config.json");

async function main() {
  const sequelize = await connectDatabase(config.database);
  const server = await createServer(sequelize, config);
}

main();
