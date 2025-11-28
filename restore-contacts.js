/**
 * Утилита для восстановления информации о контактах из WhatsApp
 * Восстанавливает номера телефонов и имена из WhatsApp API для записей в БД
 */

import { getClient } from './whatsapp-client.js';
import { query, initDatabase } from './database.js';
import { logger } from './logger.js';
import pg from 'pg';

const { Pool } = pg;

// Конфигурация БД Spring Boot (для таблиц sellers и offers)
const springBootDbConfig = {
  host: process.env.SPRING_DB_HOST || 'localhost',
  port: parseInt(process.env.SPRING_DB_PORT || '5432'),
  database: process.env.SPRING_DB_NAME || 'miners',
  user: process.env.SPRING_DB_USER || 'postgres',
  password: process.env.SPRING_DB_PASSWORD || 'vasagaroot',
};

let springBootPool = null;

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
 * @param {string} contactId - ID контакта (например, "120363046456598557@c.us" или просто "120363046456598557")
 * @returns {Promise<{phone: string, name: string, pushname: string, whatsappId: string}>}
 */
async function getContactInfo(contactId) {
  const client = getClient();
  
  if (!client) {
    throw new Error('WhatsApp клиент не инициализирован');
  }

  const status = client.info;
  if (!status || !status.wid) {
    throw new Error('WhatsApp клиент не готов');
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

    logger.info(`✅ Получена информация о контакте:`);
    logger.info(`   Номер телефона: ${phone}`);
    logger.info(`   Имя (pushname): ${pushname || 'не указано'}`);
    logger.info(`   Имя (name): ${name || 'не указано'}`);
    logger.info(`   WhatsApp ID: ${whatsappId}`);

    return {
      phone: phone,
      name: name || pushname || phone,
      pushname: pushname,
      whatsappId: whatsappId
    };
  } catch (error) {
    logger.error(`❌ Ошибка получения контакта ${formattedId}: ${error.message}`);
    
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
 * Проверяет, является ли строка WhatsApp ID (длинная числовая строка)
 */
function isWhatsAppId(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  // Убираем пробелы
  const cleaned = str.trim();
  
  // Проверяем, что это длинная числовая строка (больше 12 символов, только цифры)
  // Обычные номера телефонов обычно 10-12 цифр, WhatsApp ID - длиннее
  if (cleaned.length > 12 && /^\d+$/.test(cleaned)) {
    return true;
  }
  
  // Проверяем формат с @
  if (cleaned.includes('@') && cleaned.length > 15) {
    return true;
  }
  
  return false;
}

/**
 * Восстанавливает информацию о продавцах из таблицы sellers
 */
async function restoreSellers() {
  logger.info('═'.repeat(80));
  logger.info('📋 ВОССТАНОВЛЕНИЕ ИНФОРМАЦИИ О ПРОДАВЦАХ');
  logger.info('═'.repeat(80));

  try {
    // Находим продавцов с WhatsApp ID вместо нормальных данных
    // Используем простой запрос без функции (так как функция может не существовать)
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

    for (const seller of sellers) {
      try {
        // Определяем WhatsApp ID
        let whatsappId = seller.whatsapp_id;
        
        if (!whatsappId) {
          // Пытаемся извлечь из name или phone
          if (isWhatsAppId(seller.name)) {
            whatsappId = seller.name;
          } else if (isWhatsAppId(seller.phone)) {
            whatsappId = seller.phone;
          } else {
            logger.warn(`⚠️  Не удалось определить WhatsApp ID для продавца ID=${seller.id}`);
            skipped++;
            continue;
          }
        }

        // Получаем информацию о контакте
        const contactInfo = await getContactInfo(whatsappId);

        if (!contactInfo) {
          logger.warn(`⚠️  Не удалось получить информацию для WhatsApp ID: ${whatsappId}`);
          failed++;
          continue;
        }

        // Обновляем запись в БД
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        // Обновляем phone, если он был WhatsApp ID или пустой
        if (isWhatsAppId(seller.phone) || !seller.phone || seller.phone === whatsappId) {
          updateFields.push(`phone = $${paramIndex}`);
          updateValues.push(contactInfo.phone);
          paramIndex++;
        }

        // Обновляем name, если он был WhatsApp ID или пустой
        if (isWhatsAppId(seller.name) || !seller.name || seller.name === whatsappId) {
          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(contactInfo.name);
          paramIndex++;
        }

        // Обновляем whatsapp_id, если он был NULL
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
          
          logger.info(`✅ Обновлен продавец ID=${seller.id}:`);
          logger.info(`   Старое: name="${seller.name}", phone="${seller.phone}"`);
          logger.info(`   Новое: name="${contactInfo.name}", phone="${contactInfo.phone}"`);
          stats.updated++;
        } else {
          logger.info(`ℹ️  Продавец ID=${seller.id} уже имеет корректные данные`);
          stats.skipped++;
        }

        // Небольшая задержка, чтобы не перегружать WhatsApp API
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        logger.error(`❌ Ошибка обработки продавца ID=${seller.id}: ${error.message}`);
        stats.failed++;
      }
    }

    logger.info('═'.repeat(80));
    logger.info(`📊 РЕЗУЛЬТАТЫ ВОССТАНОВЛЕНИЯ ПРОДАВЦОВ:`);
    logger.info(`   ✅ Обновлено: ${stats.updated}`);
    logger.info(`   ⚠️  Пропущено: ${stats.skipped}`);
    logger.info(`   ❌ Ошибок: ${stats.failed}`);
    logger.info('═'.repeat(80));

    return stats;

  } catch (error) {
    logger.error(`❌ Ошибка восстановления продавцов: ${error.message}`);
    throw error;
  }
}

/**
 * Восстанавливает информацию в таблице offers
 */
async function restoreOffers() {
  // Инициализируем БД, если еще не инициализирована
  if (!springBootPool) {
    await initSpringBootDatabase();
  }

  logger.info('═'.repeat(80));
  logger.info('📋 ВОССТАНОВЛЕНИЕ ИНФОРМАЦИИ В ПРЕДЛОЖЕНИЯХ');
  logger.info('═'.repeat(80));

  const stats = {
    updated: 0,
    failed: 0,
    skipped: 0
  };

  try {
    // Находим предложения с WhatsApp ID вместо нормальных данных
    const result = await springBootPool.query(`
      SELECT id, seller_name, seller_phone
      FROM offers
      WHERE (LENGTH(seller_name) > 12 AND seller_name ~ '^[0-9]+$')
         OR (LENGTH(seller_phone) > 12 AND seller_phone ~ '^[0-9]+$')
      ORDER BY id DESC
      LIMIT 1000
    `);

    const offers = result.rows;
    logger.info(`📊 Найдено предложений для восстановления: ${offers.length}`);

    for (const offer of offers) {
      try {
        // Определяем WhatsApp ID
        let whatsappId = null;
        
        if (isWhatsAppId(offer.seller_name)) {
          whatsappId = offer.seller_name;
        } else if (isWhatsAppId(offer.seller_phone)) {
          whatsappId = offer.seller_phone;
        } else {
          stats.skipped++;
          continue;
        }

        // Получаем информацию о контакте
        const contactInfo = await getContactInfo(whatsappId);

        if (!contactInfo) {
          logger.warn(`⚠️  Не удалось получить информацию для WhatsApp ID: ${whatsappId}`);
          stats.failed++;
          continue;
        }

        // Обновляем запись в БД
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        // Обновляем seller_phone, если он был WhatsApp ID
        if (isWhatsAppId(offer.seller_phone) || offer.seller_phone === whatsappId) {
          updateFields.push(`seller_phone = $${paramIndex}`);
          updateValues.push(contactInfo.phone);
          paramIndex++;
        }

        // Обновляем seller_name, если он был WhatsApp ID
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
          
          logger.info(`✅ Обновлено предложение ID=${offer.id}:`);
          logger.info(`   Старое: seller_name="${offer.seller_name}", seller_phone="${offer.seller_phone}"`);
          logger.info(`   Новое: seller_name="${contactInfo.name}", seller_phone="${contactInfo.phone}"`);
          stats.updated++;
        } else {
          stats.skipped++;
        }

        // Небольшая задержка
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        logger.error(`❌ Ошибка обработки предложения ID=${offer.id}: ${error.message}`);
        stats.failed++;
      }
    }

    logger.info('═'.repeat(80));
    logger.info(`📊 РЕЗУЛЬТАТЫ ВОССТАНОВЛЕНИЯ ПРЕДЛОЖЕНИЙ:`);
    logger.info(`   ✅ Обновлено: ${stats.updated}`);
    logger.info(`   ⚠️  Пропущено: ${stats.skipped}`);
    logger.info(`   ❌ Ошибок: ${stats.failed}`);
    logger.info('═'.repeat(80));

    return stats;

  } catch (error) {
    logger.error(`❌ Ошибка восстановления предложений: ${error.message}`);
    throw error;
  }
}

/**
 * Главная функция восстановления
 */
async function main() {
  try {
    logger.info('🚀 Запуск утилиты восстановления контактов...');
    logger.info('═'.repeat(80));

    // Проверяем, что WhatsApp клиент готов
    const client = getClient();
    if (!client) {
      throw new Error('WhatsApp клиент не инициализирован. Убедитесь, что WhatsApp сервис запущен.');
    }

    const status = client.info;
    if (!status || !status.wid) {
      throw new Error('WhatsApp клиент не готов. Дождитесь подключения.');
    }

    logger.info('✅ WhatsApp клиент готов');
    logger.info(`   Подключен как: ${status.pushname} (${status.wid.user})`);

    // Инициализируем БД Spring Boot
    await initSpringBootDatabase();

    // Восстанавливаем продавцов
    await restoreSellers();

    // Восстанавливаем предложения
    await restoreOffers();

    logger.info('═'.repeat(80));
    logger.info('✅ Восстановление завершено!');
    logger.info('═'.repeat(80));

    // Закрываем соединения
    if (springBootPool) {
      await springBootPool.end();
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
    
    process.exit(1);
  }
}

// Экспортируем функции для использования в других модулях
export { restoreSellers, restoreOffers, getContactInfo, initSpringBootDatabase };

