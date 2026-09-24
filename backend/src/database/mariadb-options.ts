export function mariaDbUtcConnectionOptions() {
  return {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3307),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    // MegaMitra persists business instants in MySQL DATETIME columns using UTC.
    // Use an explicit numeric offset supported by MariaDB Connector/Node.js so
    // Date parameter serialization and session time functions share one clock.
    timezone: '+00:00',
    connectTimeout: 5000,
    acquireTimeout: 10000,
  };
}
