import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Spring Boot API endpoint
  apiUrl: process.env.API_URL || 'https://minerhive.ru',
  apiEndpoint: process.env.API_ENDPOINT || '/api/webhook/whatsapp',
  
  // API ключ для авторизации (опционально)
  apiKey: process.env.API_KEY || null,
  
  // ID групп для мониторинга (можно указать несколько через запятую)
  // Можно указать как ID группы, так и название группы
  monitoredGroups: process.env.MONITORED_GROUPS 
    ? process.env.MONITORED_GROUPS.split(',').map(g => g.trim())
    : [],
  
  // Путь для сохранения сессии WhatsApp
  sessionPath: process.env.SESSION_PATH || './.wwebjs_auth',
  
  // Настройки логирования
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Retry настройки при ошибке отправки на API
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
  retryDelay: parseInt(process.env.RETRY_DELAY || '5000'),
};

