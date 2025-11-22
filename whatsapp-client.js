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
    qrCodeData = qr;
    clientStatus = 'connecting';
    logger.info('📱 QR-код сгенерирован');
    console.log('\n');
    qrcode.generate(qr, { small: true });
    console.log('\n');
  });

  // Готовность клиента
  client.on('ready', async () => {
    clientStatus = 'ready';
    qrCodeData = null;
    logger.info('✅ WhatsApp клиент готов!');
    const clientInfo = client.info;
    logger.info(`Подключен как: ${clientInfo.pushname} (${clientInfo.wid.user})`);
  });

  // Аутентификация
  client.on('authenticated', () => {
    clientStatus = 'connected';
    qrCodeData = null;
    logger.info('✅ Аутентификация успешна');
  });

  // Ошибка аутентификации
  client.on('auth_failure', (msg) => {
    clientStatus = 'disconnected';
    logger.error('❌ Ошибка аутентификации WhatsApp:', msg);
  });

  // Разрыв соединения
  client.on('disconnected', (reason) => {
    clientStatus = 'disconnected';
    logger.warn('⚠️  WhatsApp клиент отключен:', reason);
  });

  // Ошибка клиента
  client.on('error', (error) => {
    logger.error('❌ Ошибка WhatsApp клиента:', error);
  });

  return client;
}

/**
 * Инициализирует клиент
 */
export async function initializeClient(sessionPath) {
  if (!client) {
    createClient(sessionPath);
  }

  if (clientStatus === 'disconnected' || clientStatus === 'connecting') {
    clientStatus = 'connecting';
    try {
      await client.initialize();
    } catch (error) {
      clientStatus = 'disconnected';
      logger.error('❌ Ошибка инициализации WhatsApp клиента:', error);
      throw error;
    }
  }

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
