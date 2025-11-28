import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { logger } from './logger.js';

// Глобальный экземпляр клиента
let client = null;
let qrCodeData = null;
let clientStatus = 'disconnected'; // disconnected, connecting, connected, ready

/**
 * Создает и инициализирует WhatsApp клиент
 */
export function createClient(sessionPath) {
  if (client) {
    return client;
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: sessionPath
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  // Генерация QR-кода
  client.on('qr', (qr) => {
    logger.info('═'.repeat(80));
    logger.info('📱 ЭТАП 1: ГЕНЕРАЦИЯ QR-КОДА');
    logger.info('═'.repeat(80));
    qrCodeData = qr;
    clientStatus = 'connecting';
    logger.info('📱 QR-код сгенерирован');
    logger.info('📱 Статус изменен на: connecting');
    console.log('\n');
    qrcode.generate(qr, { small: true });
    console.log('\n');
    logger.info('📱 QR-код отображен в консоли');
    logger.info('═'.repeat(80));
  });

  // Готовность клиента
  client.on('ready', async () => {
    logger.info('═'.repeat(80));
    logger.info('✅ ЭТАП 4: КЛИЕНТ ГОТОВ К РАБОТЕ');
    logger.info('═'.repeat(80));
    clientStatus = 'ready';
    qrCodeData = null;
    logger.info('✅ WhatsApp клиент готов!');
    logger.info('✅ Статус изменен на: ready');
    const clientInfo = client.info;
    logger.info(`✅ Подключен как: ${clientInfo.pushname} (${clientInfo.wid.user})`);
    logger.info(`✅ ID клиента: ${clientInfo.wid._serialized}`);
    logger.info('✅ Клиент готов к приему и обработке сообщений');
    logger.info('═'.repeat(80));
  });

  // Аутентификация
  client.on('authenticated', () => {
    logger.info('═'.repeat(80));
    logger.info('✅ ЭТАП 3: АУТЕНТИФИКАЦИЯ УСПЕШНА');
    logger.info('═'.repeat(80));
    clientStatus = 'connected';
    qrCodeData = null;
    logger.info('✅ Аутентификация успешна');
    logger.info('✅ Статус изменен на: connected');
    logger.info('✅ Ожидаем готовности клиента...');
    logger.info('═'.repeat(80));
  });

  // Ошибка аутентификации
  client.on('auth_failure', (msg) => {
    logger.error('═'.repeat(80));
    logger.error('❌ ЭТАП 3: ОШИБКА АУТЕНТИФИКАЦИИ');
    logger.error('═'.repeat(80));
    clientStatus = 'disconnected';
    logger.error('❌ Ошибка аутентификации WhatsApp:', msg);
    logger.error('❌ Статус изменен на: disconnected');
    logger.error('═'.repeat(80));
  });

  // Разрыв соединения
  client.on('disconnected', (reason) => {
    logger.warn('═'.repeat(80));
    logger.warn('⚠️  СОЕДИНЕНИЕ РАЗОРВАНО');
    logger.warn('═'.repeat(80));
    clientStatus = 'disconnected';
    logger.warn('⚠️  WhatsApp клиент отключен');
    logger.warn(`⚠️  Причина: ${reason}`);
    logger.warn('⚠️  Статус изменен на: disconnected');
    logger.warn('═'.repeat(80));
  });

  // Ошибка клиента
  client.on('error', (error) => {
    logger.error('═'.repeat(80));
    logger.error('❌ ОШИБКА WHATSAPP КЛИЕНТА');
    logger.error('═'.repeat(80));
    logger.error('❌ Ошибка WhatsApp клиента:', error);
    if (error.stack) {
      logger.error('❌ Stack trace:', error.stack);
    }
    logger.error('═'.repeat(80));
  });

  return client;
}

/**
 * Инициализирует клиент
 */
export async function initializeClient(sessionPath) {
  logger.info('═'.repeat(80));
  logger.info('🚀 НАЧАЛО ИНИЦИАЛИЗАЦИИ WHATSAPP КЛИЕНТА');
  logger.info('═'.repeat(80));
  logger.info(`📁 Путь к сессии: ${sessionPath}`);
  logger.info(`📊 Текущий статус: ${clientStatus}`);
  
  if (!client) {
    logger.info('📦 Создание нового клиента...');
    createClient(sessionPath);
    logger.info('✅ Клиент создан');
  } else {
    logger.info('ℹ️  Клиент уже существует, используем существующий');
  }

  if (clientStatus === 'disconnected' || clientStatus === 'connecting') {
    logger.info('🔄 Начало инициализации клиента...');
    clientStatus = 'connecting';
    logger.info('📊 Статус изменен на: connecting');
    try {
      logger.info('⏳ Вызов client.initialize()...');
      await client.initialize();
      logger.info('✅ client.initialize() завершен успешно');
    } catch (error) {
      clientStatus = 'disconnected';
      logger.error('═'.repeat(80));
      logger.error('❌ ОШИБКА ИНИЦИАЛИЗАЦИИ WHATSAPP КЛИЕНТА');
      logger.error('═'.repeat(80));
      logger.error('❌ Ошибка инициализации WhatsApp клиента:', error);
      if (error.stack) {
        logger.error('❌ Stack trace:', error.stack);
      }
      logger.error('❌ Статус изменен на: disconnected');
      logger.error('═'.repeat(80));
      throw error;
    }
  } else {
    logger.info(`ℹ️  Клиент уже инициализирован (статус: ${clientStatus}), пропускаем инициализацию`);
  }

  logger.info('═'.repeat(80));
  logger.info('✅ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА');
  logger.info('═'.repeat(80));
  return client;
}

/**
 * Получает текущий статус клиента
 */
export function getClientStatus() {
  return {
    status: clientStatus,
    qrCode: qrCodeData,
    isReady: clientStatus === 'ready',
    isConnected: clientStatus === 'ready' || clientStatus === 'connected'
  };
}

/**
 * Получает экземпляр клиента
 */
export function getClient() {
  return client;
}

/**
 * Деинициализирует клиент
 */
export async function destroyClient() {
  if (client) {
    await client.destroy();
    client = null;
    clientStatus = 'disconnected';
    qrCodeData = null;
  }
}
