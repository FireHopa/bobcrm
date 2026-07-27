module.exports = {
  apps: [
    {
      name: "crm-casa-ads-api",
      cwd: "/var/www/crm-casa-ads",
      script: "server/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 3000,
      kill_timeout: 35000,
      time: true,
      env: {
        NODE_ENV: "production",
        PROCESS_ROLE: "api",
      },
    },
    {
      name: "crm-casa-ads-worker",
      cwd: "/var/www/crm-casa-ads",
      script: "server/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 3000,
      kill_timeout: 35000,
      time: true,
      env: {
        NODE_ENV: "production",
        PROCESS_ROLE: "worker",
      },
    },
  ],
};
