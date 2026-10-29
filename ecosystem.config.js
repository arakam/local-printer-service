module.exports = {
  apps: [{
    name: 'local-printer-service',
    script: 'index.js',
    cwd: process.cwd(),
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 9100,
      NOME_IMPRESSORA: 'Microsoft Print to PDF',
      SIMULACAO: 'false'
    },
    env_simulacao: {
      NODE_ENV: 'production',
      PORT: 9100,
      NOME_IMPRESSORA: 'ZDesigner ZD420-203dpi ZPL',
      SIMULACAO: 'true'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
