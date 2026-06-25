module.exports = {
  apps: [{
    name: 'pdm-platform',
    script: 'server.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 4000,
      HOST: '0.0.0.0',
      SESSION_SECRET: 'pdm-secret-key-2026-enterprise',
      ALLOWED_ORIGINS: 'http://localhost:4000'
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/pdm-error.log',
    out_file: './logs/pdm-out.log',
    merge_logs: true
  }]
};
