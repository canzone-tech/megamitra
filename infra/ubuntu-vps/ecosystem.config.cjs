'use strict';

// Operational process metadata only, NOT application source.
// Deploy to /etc/megagoldenclub/ecosystem.config.cjs under a dedicated
// unprivileged `megagoldenclub` Unix account and its OWN PM2_HOME. Never
// install/start these apps under the existing root-owned FixTradeZone PM2.
//
// Node.js 24 --env-file loads API secrets INSIDE the API child process.
// No secrets appear in ecosystem.config.cjs or PM2's persisted app.env map.
// /etc/megagoldenclub/api.env must be readable by the service user, e.g.
// owner root, group megagoldenclub, mode 0640; directory mode 0750.
const root = '/opt/megagoldenclub/current';

module.exports = {
  apps: [
    {
      name: 'megagoldenclub-api',
      cwd: `${root}/api`,
      script: 'dist/main.js',
      interpreter: '/usr/bin/node',
      node_args: '--env-file=/etc/megagoldenclub/api.env',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3200',
      },
    },
    {
      name: 'megagoldenclub-admin',
      cwd: `${root}/admin`,
      script: 'server.js',
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: '3201',
        MEGAGOLDENCLUB_API_URL: 'http://127.0.0.1:3200',
      },
    },
    {
      name: 'megagoldenclub-member',
      cwd: `${root}/member`,
      script: 'server.js',
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: '3202',
        MEGAGOLDENCLUB_API_URL: 'http://127.0.0.1:3200',
      },
    },
  ],
};
