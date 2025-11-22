import { initializeClient, getClientStatus, getClient } from './whatsapp-client.js';
import { initializeMessageHandler } from './message-handler.js';
import { startWebServer } from './web-server.js';
import { loadConfig } from './config-manager.js';
import { config } from './config.js';
import { logger } from './logger.js';

// Загружаем конфигурацию мониторинга
loadConfig();

// Запускаем веб-сервер
startWebServer();

// Инициализируем WhatsApp клиент
logger.info('🚀 Запуск WhatsApp сервиса...');
logger.info(`Конфигурация:`);
logger.info(`  - Веб-интерфейс: http://localhost:${process.env.WEB_PORT || 3000}`);
logger.info(`  - Сессия: ${config.sessionPath}`);
logger.info('');

// Инициализация WhatsApp клиента
async function init() {
  try {
    await initializeClient(config.sessionPath);
    initializeMessageHandler();
    
    // Проверяем статус каждые 5 секунд и выводим информацию
    setInterval(() => {
      const status = getClientStatus();
      if (status.status === 'ready' && !status.isReady) {
        logger.info('Ожидание готовности клиента...');
      }
    }, 5000);
    
  } catch (error) {
    logger.error('❌ Ошибка инициализации:', error);
  }
}

init();

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('\n🛑 Получен сигнал завершения. Закрытие клиента...');
  const { destroyClient } = await import('./whatsapp-client.js');
  await destroyClient();
  logger.info('✅ Клиент закрыт. До свидания!');
  process.exit(0);
});