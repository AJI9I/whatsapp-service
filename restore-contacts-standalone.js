/**
 * Стенд-алон утилита для восстановления информации о контактах из WhatsApp
 * Запускается отдельно, требует активного подключения WhatsApp
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { logger } from './logger.js';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config({ path: join(__dirname, '.env') });

// Конфигурация БД Spring Boot
const springBootDbConfig = {
  host: process.env.SPRING_DB_HOST || 'localhost',
  port: parseInt(process.env.SPRING_DB_PORT || '5432'),
  database: process.env.SPRING_DB_NAME || 'miners',
  user: process.env.SPRING_DB_USER || 'postgres',
  password: process.env.SPRING_DB_PASSWORD || 'vasagaroot',
};

let client = null;
let springBootPool = null;

/**
 * Инициализирует WhatsApp клиент
 */
async function initWhatsAppClient() {
  const sessionPath = process.env.SESSION_PATH || './.wwebjs_auth';

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

  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      logger.info('✅ WhatsApp клиент готов!');
      const clientInfo = client.info;
      logger.info(`Подключен как: ${clientInfo.pushname} (${clientInfo.wid.user})`);
      resolve(client);
    });

    client.on('qr', (qr) => {
      logger.info('📱 Отсканируйте QR-код для подключения к WhatsApp');
      console.log('\n');
      require('qrcode-terminal').generate(qr, { small: true });
      console.log('\n');
    });

    client.on('auth_failure', (msg) => {
      logger.error('❌ Ошибка аутентификации WhatsApp:', msg);
      reject(new Error('Ошибка аутентификации'));
    });

    client.on('disconnected', (reason) => {
      logger.warn('⚠️  WhatsApp клиент отключен:', reason);
    });

    client.initialize().catch(reject);
  });
}

/**
 * Инициализирует подключение к БД Spring Boot
 */
async function initSpringBootDatabase() {
  if (springBootPool) {
    return springBootPool;
  }

  springBootPool = new Pool(springBootDbConfig);
  
  try {
    await springBootPool.query('SELECT NOW()');
    logger.info('✅ Подключение к БД Spring Boot установлено');
    logger.info(`   База данных: ${springBootDbConfig.database}`);
    return springBootPool;
  } catch (err) {
    logger.error('❌ Ошибка подключения к БД Spring Boot:', err.message);
    throw err;
  }
}

/**
 * Получает информацию о контакте из WhatsApp по ID
 */
async function getContactInfo(contactId) {
  if (!client) {
    throw new Error('WhatsApp клиент не инициализирован');
  }

  try {
    // Форматируем contactId: если нет @, добавляем @c.us
    let formattedId = contactId;
    if (!contactId.includes('@')) {
      formattedId = `${contactId}@c.us`;
    }

    logger.info(`🔍 Получение информации о контакте: ${formattedId}`);

    // Пытаемся получить контакт по ID
    // В whatsapp-web.js может быть метод getContactById или нужно использовать другой способ
    let contact = null;
    
    try {
      // Пробуем getContactById (если доступен)
      if (typeof client.getContactById === 'function') {
        contact = await client.getContactById(formattedId);
      } else {
        // Альтернативный способ: получаем все контакты и ищем нужный
        logger.info(`⚠️  Метод getContactById недоступен, используем альтернативный способ`);
        const contacts = await client.getContacts();
        const userId = contactId.split('@')[0];
        contact = contacts.find(c => {
          const cId = c.id?._serialized || '';
          const cUser = c.id?.user || '';
          return cId === formattedId || 
                 cUser === userId ||
                 c.number === userId;
        });
      }
    } catch (methodError) {
      logger.warn(`⚠️  Ошибка при получении контакта, пробуем альтернативный способ: ${methodError.message}`);
      // Пробуем получить через список контактов
      try {
        const contacts = await client.getContacts();
        const userId = contactId.split('@')[0];
        contact = contacts.find(c => 
          c.id?._serialized === formattedId || 
          c.id?.user === userId ||
          c.number === userId
        );
      } catch (contactsError) {
        logger.error(`❌ Не удалось получить контакт: ${contactsError.message}`);
        return null;
      }
    }

    if (!contact) {
      logger.warn(`⚠️  Контакт не найден: ${formattedId}`);
      return null;
    }

    // Извлекаем информацию
    const phone = contact.number || contact.id?.user || contactId.split('@')[0];
    const pushname = contact.pushname || null;
    const name = contact.name || pushname || null;
    const whatsappId = contact.id?._serialized || formattedId;

    logger.info(`✅ Получена информация:`);
    logger.info(`   Номер: ${phone}`);
    logger.info(`   Имя: ${name || pushname || 'не указано'}`);
    logger.info(`   WhatsApp ID: ${whatsappId}`);

    return {
      phone: phone,
      name: name || pushname || phone,
      pushname: pushname,
      whatsappId: whatsappId
    };
  } catch (error) {
    logger.error(`❌ Ошибка получения контакта ${contactId}: ${error.message}`);
    
    // Если контакт не найден, пытаемся извлечь номер из ID
    const phoneFromId = contactId.split('@')[0];
    if (phoneFromId && phoneFromId.length > 10) {
      logger.info(`📞 Используем номер из ID: ${phoneFromId}`);
      return {
        phone: phoneFromId,
        name: null,
        pushname: null,
        whatsappId: formattedId
      };
    }
    
    return null;
  }
}

/**
 * Проверяет, является ли строка WhatsApp ID
 */
function isWhatsAppId(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  const cleaned = str.trim();
  
  // Длинная числовая строка (больше 12 символов)
  if (cleaned.length > 12 && /^\d+$/.test(cleaned)) {
    return true;
  }
  
  // Формат с @
  if (cleaned.includes('@') && cleaned.length > 15) {
    return true;
  }
  
  return false;
}

/**
 * Восстанавливает информацию о продавцах
 */
async function restoreSellers() {
  logger.info('═'.repeat(80));
  logger.info('📋 ВОССТАНОВЛЕНИЕ ИНФОРМАЦИИ О ПРОДАВЦАХ');
  logger.info('═'.repeat(80));

  try {
    // Находим продавцов с WhatsApp ID
    const result = await springBootPool.query(`
      SELECT id, name, phone, whatsapp_id
      FROM sellers
      WHERE (LENGTH(name) > 12 AND name ~ '^[0-9]+$')
         OR (LENGTH(phone) > 12 AND phone ~ '^[0-9]+$')
         OR (whatsapp_id IS NULL AND (LENGTH(name) > 12 OR LENGTH(phone) > 12))
      ORDER BY id DESC
      LIMIT 1000
    `);

    const sellers = result.rows;
    logger.info(`📊 Найдено продавцов для восстановления: ${sellers.length}`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const seller of sellers) {
      try {
        // Определяем WhatsApp ID
        let whatsappId = seller.whatsapp_id;
        
        if (!whatsappId) {
          if (isWhatsAppId(seller.name)) {
            whatsappId = seller.name;
          } else if (isWhatsAppId(seller.phone)) {
            whatsappId = seller.phone;
          } else {
            skipped++;
            continue;
          }
        }

        // Получаем информацию о контакте
        const contactInfo = await getContactInfo(whatsappId);

        if (!contactInfo) {
          failed++;
          continue;
        }

        // Обновляем запись
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (isWhatsAppId(seller.phone) || !seller.phone || seller.phone === whatsappId) {
          updateFields.push(`phone = $${paramIndex}`);
          updateValues.push(contactInfo.phone);
          paramIndex++;
        }

        if (isWhatsAppId(seller.name) || !seller.name || seller.name === whatsappId) {
          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(contactInfo.name);
          paramIndex++;
        }

        if (!seller.whatsapp_id) {
          updateFields.push(`whatsapp_id = $${paramIndex}`);
          updateValues.push(contactInfo.whatsappId);
          paramIndex++;
        }

        if (updateFields.length > 0) {
          updateValues.push(seller.id);
          const updateQuery = `
            UPDATE sellers
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex}
          `;

          await springBootPool.query(updateQuery, updateValues);
          
          logger.info(`✅ ID=${seller.id}: "${seller.name}" → "${contactInfo.name}", "${seller.phone}" → "${contactInfo.phone}"`);
          updated++;
        } else {
          skipped++;
        }

        // Задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        logger.error(`❌ Ошибка продавца ID=${seller.id}: ${error.message}`);
        failed++;
      }
    }

    logger.info('═'.repeat(80));
    logger.info(`📊 РЕЗУЛЬТАТЫ: Обновлено=${updated}, Пропущено=${skipped}, Ошибок=${failed}`);
    logger.info('═'.repeat(80));

  } catch (error) {
    logger.error(`❌ Ошибка восстановления продавцов: ${error.message}`);
    throw error;
  }
}

/**
 * Восстанавливает информацию в предложениях
 */
async function restoreOffers() {
  logger.info('═'.repeat(80));
  logger.info('📋 ВОССТАНОВЛЕНИЕ ИНФОРМАЦИИ В ПРЕДЛОЖЕНИЯХ');
  logger.info('═'.repeat(80));

  try {
    const result = await springBootPool.query(`
      SELECT id, seller_name, seller_phone
      FROM offers
      WHERE (LENGTH(seller_name) > 12 AND seller_name ~ '^[0-9]+$')
         OR (LENGTH(seller_phone) > 12 AND seller_phone ~ '^[0-9]+$')
      ORDER BY id DESC
      LIMIT 1000
    `);

    const offers = result.rows;
    logger.info(`📊 Найдено предложений: ${offers.length}`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const offer of offers) {
      try {
        let whatsappId = null;
        
        if (isWhatsAppId(offer.seller_name)) {
          whatsappId = offer.seller_name;
        } else if (isWhatsAppId(offer.seller_phone)) {
          whatsappId = offer.seller_phone;
        } else {
          skipped++;
          continue;
        }

        const contactInfo = await getContactInfo(whatsappId);

        if (!contactInfo) {
          failed++;
          continue;
        }

        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (isWhatsAppId(offer.seller_phone) || offer.seller_phone === whatsappId) {
          updateFields.push(`seller_phone = $${paramIndex}`);
          updateValues.push(contactInfo.phone);
          paramIndex++;
        }

        if (isWhatsAppId(offer.seller_name) || offer.seller_name === whatsappId) {
          updateFields.push(`seller_name = $${paramIndex}`);
          updateValues.push(contactInfo.name);
          paramIndex++;
        }

        if (updateFields.length > 0) {
          updateValues.push(offer.id);
          const updateQuery = `
            UPDATE offers
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
          `;

          await springBootPool.query(updateQuery, updateValues);
          
          logger.info(`✅ ID=${offer.id}: "${offer.seller_name}" → "${contactInfo.name}", "${offer.seller_phone}" → "${contactInfo.phone}"`);
          updated++;
        } else {
          skipped++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        logger.error(`❌ Ошибка предложения ID=${offer.id}: ${error.message}`);
        failed++;
      }
    }

    logger.info('═'.repeat(80));
    logger.info(`📊 РЕЗУЛЬТАТЫ: Обновлено=${updated}, Пропущено=${skipped}, Ошибок=${failed}`);
    logger.info('═'.repeat(80));

  } catch (error) {
    logger.error(`❌ Ошибка восстановления предложений: ${error.message}`);
    throw error;
  }
}

/**
 * Главная функция
 */
async function main() {
  try {
    logger.info('🚀 Запуск утилиты восстановления контактов...');
    logger.info('═'.repeat(80));

    // Инициализируем WhatsApp клиент
    await initWhatsAppClient();

    // Инициализируем БД Spring Boot
    await initSpringBootDatabase();

    // Восстанавливаем данные
    await restoreSellers();
    await restoreOffers();

    logger.info('═'.repeat(80));
    logger.info('✅ Восстановление завершено!');
    logger.info('═'.repeat(80));

    // Закрываем соединения
    if (springBootPool) {
      await springBootPool.end();
    }
    if (client) {
      await client.destroy();
    }

    process.exit(0);

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
    if (error.stack) {
      logger.error('Стек ошибки:', error.stack);
    }
    
    if (springBootPool) {
      await springBootPool.end();
    }
    if (client) {
      await client.destroy();
    }
    
    process.exit(1);
  }
}

// Запускаем
main();

