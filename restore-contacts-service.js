/**
 * Сервис для восстановления контактов с поддержкой потоковой передачи логов
 */

import { getClient } from './whatsapp-client.js';
import { logger } from './logger.js';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config({ path: join(__dirname, '.env') });

/**
 * Парсит JDBC URL в конфигурацию для PostgreSQL
 */
function parseJdbcUrl(jdbcUrl) {
  // Формат: jdbc:postgresql://host:port/database
  const match = jdbcUrl.match(/jdbc:postgresql:\/\/([^:]+):(\d+)\/(.+)/);
  if (match) {
    return {
      host: match[1],
      port: parseInt(match[2]),
      database: match[3]
    };
  }
  return null;
}

/**
 * Читает конфигурацию из application.yml Spring Boot
 */
function readSpringBootConfig() {
  try {
    // Путь к application.yml относительно текущего файла
    const appYmlPath = join(__dirname, '..', 'shop-backend', 'src', 'main', 'resources', 'application.yml');
    
    if (fs.existsSync(appYmlPath)) {
      const fileContents = fs.readFileSync(appYmlPath, 'utf8');
      const config = yaml.load(fileContents);
      
      if (config?.spring?.datasource) {
        const ds = config.spring.datasource;
        let jdbcUrl = ds.url || '';
        
        // Обрабатываем переменные окружения в формате ${VAR:default}
        if (jdbcUrl.includes('${')) {
          const match = jdbcUrl.match(/\$\{SPRING_DATASOURCE_URL:([^}]+)\}/);
          if (match) {
            jdbcUrl = process.env.SPRING_DATASOURCE_URL || match[1];
          }
        }
        
        const parsed = parseJdbcUrl(jdbcUrl);
        
        if (parsed) {
          let username = ds.username || 'postgres';
          let password = ds.password || 'vasagaroot';
          
          // Обрабатываем переменные окружения
          if (typeof username === 'string' && username.includes('${')) {
            const match = username.match(/\$\{SPRING_DATASOURCE_USERNAME:([^}]+)\}/);
            if (match) {
              username = process.env.SPRING_DATASOURCE_USERNAME || match[1];
            }
          }
          
          if (typeof password === 'string' && password.includes('${')) {
            const match = password.match(/\$\{SPRING_DATASOURCE_PASSWORD:([^}]+)\}/);
            if (match) {
              password = process.env.SPRING_DATASOURCE_PASSWORD || match[1];
            }
          }
          
          return {
            ...parsed,
            user: username,
            password: password
          };
        }
      }
    }
  } catch (error) {
    logger.warn(`Не удалось прочитать application.yml: ${error.message}`);
  }
  return null;
}

/**
 * Получает конфигурацию БД Spring Boot из переменных окружения или application.yml
 */
function getSpringBootDbConfig() {
  // Пробуем получить из переменных окружения (приоритет)
  const jdbcUrl = process.env.SPRING_DATASOURCE_URL;
  
  if (jdbcUrl) {
    const parsed = parseJdbcUrl(jdbcUrl);
    if (parsed) {
      return {
        ...parsed,
        user: process.env.SPRING_DATASOURCE_USERNAME || 'postgres',
        password: process.env.SPRING_DATASOURCE_PASSWORD || 'vasagaroot'
      };
    }
  }
  
  // Пробуем отдельные переменные
  if (process.env.SPRING_DB_HOST) {
    return {
      host: process.env.SPRING_DB_HOST,
      port: parseInt(process.env.SPRING_DB_PORT || '5432'),
      database: process.env.SPRING_DB_NAME || 'miners',
      user: process.env.SPRING_DB_USER || process.env.SPRING_DATASOURCE_USERNAME || 'postgres',
      password: process.env.SPRING_DB_PASSWORD || process.env.SPRING_DATASOURCE_PASSWORD || 'vasagaroot'
    };
  }
  
  // Пробуем прочитать из application.yml
  const ymlConfig = readSpringBootConfig();
  if (ymlConfig) {
    return ymlConfig;
  }
  
  // Значения по умолчанию (из application.yml)
  return {
    host: 'localhost',
    port: 5432,
    database: 'miners',
    user: 'postgres',
    password: 'vasagaroot'
  };
}

// Конфигурация БД Spring Boot
const springBootDbConfig = getSpringBootDbConfig();

let springBootPool = null;

// Буфер для логов восстановления
const restoreLogs = [];
const MAX_LOG_ENTRIES = 1000;

/**
 * Добавляет лог в буфер
 */
function addLog(level, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  
  restoreLogs.push(logEntry);
  
  // Ограничиваем размер буфера
  if (restoreLogs.length > MAX_LOG_ENTRIES) {
    restoreLogs.shift();
  }
  
  // Также логируем в основной логгер
  if (level === 'error') {
    logger.error(`[RESTORE] ${message}`);
  } else if (level === 'warn') {
    logger.warn(`[RESTORE] ${message}`);
  } else {
    logger.info(`[RESTORE] ${message}`);
  }
}

/**
 * Очищает логи восстановления
 */
export function clearRestoreLogs() {
  restoreLogs.length = 0;
}

/**
 * Получает логи восстановления
 */
export function getRestoreLogs() {
  return [...restoreLogs];
}

/**
 * Инициализирует подключение к БД Spring Boot
 */
async function initSpringBootDatabase() {
  if (springBootPool) {
    // Проверяем, что соединение еще активно
    try {
      await springBootPool.query('SELECT NOW()');
      return springBootPool;
    } catch (error) {
      // Соединение разорвано, создаем новое
      logger.warn(`Соединение с БД разорвано, переподключаемся: ${error.message}`);
      addLog('warn', `⚠️ Соединение с БД разорвано, переподключаемся: ${error.message}`);
      try {
        await springBootPool.end();
      } catch (e) {
        // Игнорируем ошибки при закрытии
      }
      springBootPool = null;
    }
  }

  try {
    addLog('info', `🔌 Инициализация подключения к базе данных Spring Boot...`);
    addLog('debug', `   Host: ${springBootDbConfig.host}`);
    addLog('debug', `   Port: ${springBootDbConfig.port}`);
    addLog('debug', `   Database: ${springBootDbConfig.database}`);
    addLog('debug', `   User: ${springBootDbConfig.user}`);
    
    springBootPool = new Pool(springBootDbConfig);
    
    // Тестируем подключение
    await springBootPool.query('SELECT NOW()');
    addLog('info', `✅ Подключение к базе данных Spring Boot установлено`);
    
    return springBootPool;
  } catch (error) {
    logger.error(`❌ Ошибка подключения к БД Spring Boot: ${error.message}`);
    addLog('error', `❌ Ошибка подключения к БД Spring Boot: ${error.message}`);
    addLog('error', `   Host: ${springBootDbConfig.host}:${springBootDbConfig.port}`);
    addLog('error', `   Database: ${springBootDbConfig.database}`);
    addLog('error', `   Проверьте настройки подключения в application.yml или переменные окружения`);
    springBootPool = null;
    throw error;
  }
}

/**
 * Получает информацию о контакте из БД WhatsApp сервиса (из истории сообщений)
 */
async function getContactInfoFromDatabase(contactId) {
  try {
    // Импортируем функцию query из database.js
    const databaseModule = await import('./database.js');
    const query = databaseModule.query;
    
    if (!query) {
      addLog('warn', 'Функция query не найдена в database.js, пропускаем поиск в БД WhatsApp сервиса');
      return null;
    }
    
    // Ищем в БД WhatsApp сервиса по sender_id
    const userId = contactId.split('@')[0];
    const formattedId = contactId.includes('@') ? contactId : `${contactId}@c.us`;
    
    addLog('debug', `   Поиск в БД WhatsApp сервиса: formattedId=${formattedId}, userId=${userId}`);
    
    // Пробуем найти по разным вариантам ID
    const result = await query(`
      SELECT DISTINCT 
        sender_id, sender_name, sender_phone_number, 
        chat_name, MAX(timestamp) as last_message_time
      FROM whatsapp_messages
      WHERE sender_id = $1 
         OR sender_id = $2
         OR sender_id = $3
         OR sender_phone_number = $4
      GROUP BY sender_id, sender_name, sender_phone_number, chat_name
      ORDER BY last_message_time DESC
      LIMIT 1
    `, [formattedId, contactId, userId, userId]);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      if (row.sender_name && !isWhatsAppId(row.sender_name)) {
        addLog('info', `✅ Контакт найден в БД WhatsApp сервиса: ${row.sender_name} (${row.sender_phone_number || row.sender_id})`);
        return {
          phone: row.sender_phone_number || userId,
          name: row.sender_name,
          pushname: row.sender_name,
          whatsappId: row.sender_id || formattedId,
          source: 'database'
        };
      }
    }
    
    return null;
  } catch (error) {
    addLog('debug', `Ошибка поиска в БД WhatsApp сервиса: ${error.message}`);
    return null;
  }
}

/**
 * Получает информацию о контакте из WhatsApp по ID
 * @param {string} contactId - WhatsApp ID контакта
 * @returns {Promise<{phone: string, name: string, pushname: string, whatsappId: string}|null>}
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

  // Форматируем contactId
  let formattedId = contactId;
  if (!contactId.includes('@')) {
    formattedId = `${contactId}@c.us`;
  }
  
  const userId = contactId.split('@')[0];

  addLog('info', `🔍🔍🔍 НАЧАЛО ПОИСКА КОНТАКТА 🔍🔍🔍`);
  addLog('info', `   Исходный contactId: "${contactId}"`);
  addLog('info', `   Форматированный ID: "${formattedId}"`);
  addLog('info', `   Извлеченный userId: "${userId}"`);
  addLog('debug', `🔍 Получение информации о контакте: ${formattedId} (user: ${userId})`);

  let contact = null;
  let lastError = null;

  // Способ 1: Пробуем getContactById (если доступен)
  if (typeof client.getContactById === 'function') {
    try {
      addLog('debug', `   Попытка 1: getContactById(${formattedId})`);
      contact = await client.getContactById(formattedId);
      if (contact) {
        addLog('debug', `   ✅ Контакт найден через getContactById`);
      }
    } catch (error) {
      lastError = error;
      addLog('debug', `   ❌ getContactById не сработал: ${error.message}`);
    }
  }

  // Способ 2: Ищем в списке всех контактов
  if (!contact) {
    try {
      addLog('debug', `   Попытка 2: Поиск в getContacts()`);
      const contacts = await client.getContacts();
      addLog('debug', `   Всего контактов в списке: ${contacts.length}`);
      
      // Пробуем найти по разным критериям
      contact = contacts.find(c => {
        try {
          const cId = c.id?._serialized || '';
          const cUser = c.id?.user || '';
          const cNumber = c.number || '';
          
          return cId === formattedId || 
                 cId === contactId ||
                 cUser === userId ||
                 cNumber === userId ||
                 cNumber === contactId;
        } catch (e) {
          // Пропускаем контакты с ошибками доступа
          return false;
        }
      });
      
      if (contact) {
        addLog('debug', `   ✅ Контакт найден в списке контактов`);
      } else {
        addLog('debug', `   ❌ Контакт не найден в списке контактов`);
      }
    } catch (error) {
      lastError = error;
      // Это известная проблема с WhatsApp Web.js - некоторые методы могут быть недоступны
      if (error.message && error.message.includes('getIsMyContact')) {
        addLog('debug', `   ⚠️ Метод getContacts() недоступен (известная проблема WhatsApp Web.js), пропускаем`);
      } else {
        addLog('warn', `   ⚠️ Ошибка получения списка контактов: ${error.message}`);
      }
    }
  }

  // Способ 3: Пробуем получить через личные чаты
  if (!contact) {
    try {
      addLog('debug', `   Попытка 3: Поиск в личных чатах`);
      const chats = await client.getChats();
      addLog('debug', `   Всего чатов: ${chats.length}`);
      
      // Ищем в личных чатах
      for (const chat of chats) {
        if (chat.isGroup) continue;
        
        const chatId = chat.id?._serialized || '';
        if (chatId === formattedId || chatId === contactId) {
          try {
            contact = await chat.getContact();
            if (contact) {
              addLog('debug', `   ✅ Контакт найден через личный чат`);
              break;
            }
          } catch (chatError) {
            // Продолжаем поиск
          }
        }
      }
    } catch (error) {
      lastError = error;
      addLog('debug', `   ⚠️ Ошибка поиска в личных чатах: ${error.message}`);
    }
  }

  // Способ 4: Ищем в участниках всех групп
  if (!contact) {
    try {
      addLog('debug', `   Попытка 4: Поиск в участниках всех групп`);
      const chats = await client.getChats();
      addLog('debug', `   Всего чатов для проверки: ${chats.length}`);
      
      for (const chat of chats) {
        if (!chat.isGroup) continue;
        
        try {
          const participants = await chat.participants;
          
          const found = participants.find(p => {
            const pId = p.id?._serialized || '';
            const pUser = p.id?.user || '';
            const pNumber = p.number || '';
            
            // Убираем суффиксы для сравнения
            const pIdClean = pId.replace('@c.us', '').replace('@g.us', '');
            const userIdClean = userId.replace('@c.us', '').replace('@g.us', '');
            const contactIdClean = contactId.replace('@c.us', '').replace('@g.us', '');
            
            // Сравниваем разные варианты ID
            const matches = 
              pId === formattedId || 
              pId === contactId ||
              pIdClean === userId ||
              pIdClean === userIdClean ||
              pIdClean === contactId ||
              pIdClean === contactIdClean ||
              pUser === userId ||
              pUser === userIdClean ||
              pUser === contactId ||
              pUser === contactIdClean ||
              pNumber === userId ||
              pNumber === userIdClean ||
              pNumber === contactId ||
              pNumber === contactIdClean;
            
            if (matches) {
              addLog('debug', `      ✅✅✅ СОВПАДЕНИЕ НАЙДЕНО! ✅✅✅`);
              addLog('debug', `         p.id._serialized: "${pId}"`);
              addLog('debug', `         p.id.user: "${pUser}"`);
              addLog('debug', `         p.number: "${pNumber}"`);
              addLog('debug', `         pIdClean: "${pIdClean}"`);
              addLog('debug', `         Искомый contactId: "${contactId}"`);
              addLog('debug', `         Искомый userId: "${userId}"`);
              addLog('debug', `         Искомый formattedId: "${formattedId}"`);
            }
            
            return matches;
          });
          
          if (found) {
            addLog('info', `   ✅ Контакт найден в группе "${chat.name}"`);
            contact = found;
            break;
          }
        } catch (participantError) {
          // Продолжаем поиск в других группах
          addLog('debug', `   Ошибка получения участников группы ${chat.name}: ${participantError.message}`);
        }
      }
      
      if (contact) {
        addLog('debug', `   ✅ Контакт найден в участниках групп`);
      }
    } catch (error) {
      lastError = error;
      addLog('debug', `   ⚠️ Ошибка поиска в группах: ${error.message}`);
    }
  }

  // Способ 5: Ищем в последних сообщениях групп (новый метод!)
  if (!contact) {
    try {
      addLog('info', `   Попытка 5: Поиск в последних сообщениях групп`);
      const chats = await client.getChats();
      addLog('info', `   Всего чатов для проверки: ${chats.length}`);
      
      const groupChats = chats.filter(c => c.isGroup);
      addLog('info', `   Групповых чатов: ${groupChats.length}`);
      
      // Проверяем последние сообщения в каждой группе
      for (let i = 0; i < groupChats.length; i++) {
        const chat = groupChats[i];
        try {
          addLog('info', `   Проверка группы ${i + 1}/${groupChats.length}: "${chat.name}"`);
          
          // Получаем последние сообщения из группы (до 50 сообщений)
          const messages = await chat.fetchMessages({ limit: 50 });
          addLog('info', `      Найдено сообщений в группе: ${messages.length}`);
          
          // Ищем сообщения от нужного контакта
          for (const msg of messages) {
            try {
              const msgFrom = msg.from || msg.author || (msg.id && msg.id.remote) || '';
              const msgUserId = msgFrom.split('@')[0];
              
              // Сравниваем ID отправителя с искомым
              const matches = 
                msgFrom === formattedId ||
                msgFrom === contactId ||
                msgUserId === userId ||
                msgFrom.includes(userId) ||
                msgFrom.includes(contactId);
              
              if (matches) {
                addLog('info', `      ✅✅✅ НАЙДЕНО СООБЩЕНИЕ ОТ ИСКОМОГО КОНТАКТА! ✅✅✅`);
                addLog('info', `         msg.from: "${msgFrom}"`);
                addLog('info', `         msgUserId: "${msgUserId}"`);
                
                // Пытаемся получить контакт из сообщения
                try {
                  const msgContact = await msg.getContact();
                  if (msgContact) {
                    addLog('info', `         ✅ Контакт получен из сообщения`);
                    addLog('info', `         contact.number: ${msgContact.number || 'NULL'}`);
                    addLog('info', `         contact.id?.user: ${msgContact.id?.user || 'NULL'}`);
                    addLog('info', `         contact.name: ${msgContact.name || 'NULL'}`);
                    addLog('info', `         contact.pushname: ${msgContact.pushname || 'NULL'}`);
                    
                    contact = msgContact;
                    break; // Прерываем поиск по сообщениям
                  }
                } catch (contactError) {
                  // Если не удалось получить контакт через getContact(), используем данные из сообщения
                  addLog('info', `         ⚠️ Не удалось получить контакт через getContact(), используем данные из сообщения`);
                  
                  const notifyName = msg.notifyName || msg.pushName || msg.fromName || msgUserId;
                  const phone = formatPhoneNumber(msgUserId);
                  
                  addLog('info', `         notifyName: "${notifyName}"`);
                  addLog('info', `         phone (из userId): "${phone || msgUserId}"`);
                  
                  // Создаем контакт из данных сообщения
                  contact = {
                    id: {
                      user: msgUserId,
                      _serialized: msgFrom,
                      server: msgFrom.includes('@g.us') ? 'g.us' : 'c.us'
                    },
                    pushname: notifyName,
                    number: phone || msgUserId,
                    name: notifyName,
                    isMyContact: false,
                    isUser: true,
                    isGroup: msgFrom.includes('@g.us'),
                    isWAContact: false
                  };
                  break; // Прерываем поиск по сообщениям
                }
              }
            } catch (msgError) {
              // Продолжаем поиск в других сообщениях
              addLog('debug', `         Ошибка обработки сообщения: ${msgError.message}`);
            }
          }
          
          // Если контакт найден, прерываем поиск по группам
          if (contact) {
            addLog('info', `   ✅✅✅ КОНТАКТ НАЙДЕН В СООБЩЕНИЯХ ГРУППЫ "${chat.name}" ✅✅✅`);
            break;
          }
        } catch (chatError) {
          addLog('debug', `   Ошибка проверки группы "${chat.name}": ${chatError.message}`);
        }
      }
      
      if (!contact) {
        addLog('warn', `   ❌ Контакт не найден в последних сообщениях групп`);
      }
    } catch (error) {
      lastError = error;
      addLog('debug', `   ⚠️ Ошибка поиска в сообщениях групп: ${error.message}`);
    }
  }

  // Способ 6: Ищем в БД WhatsApp сервиса (из истории сообщений)
  if (!contact) {
    try {
      addLog('debug', `   Попытка 6: Поиск в БД WhatsApp сервиса`);
      const dbContact = await getContactInfoFromDatabase(contactId);
      if (dbContact) {
        addLog('info', `   ✅ Контакт найден в БД: ${dbContact.name} (${dbContact.phone})`);
        return dbContact;
      }
    } catch (error) {
      lastError = error;
      addLog('debug', `   ⚠️ Ошибка поиска в БД: ${error.message}`);
    }
  }

  // Если контакт найден, извлекаем информацию
  if (contact) {
    try {
      addLog('info', `📋📋📋 ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ИЗ НАЙДЕННОГО КОНТАКТА 📋📋📋`);
      
      // Детальное логирование процесса поиска номера телефона
      addLog('info', `   🔍 Поиск номера телефона:`);
      addLog('debug', `      Проверка contact.number: ${contact.number || 'NULL/undefined'}`);
      addLog('debug', `      Проверка contact.id?.user: ${contact.id?.user || 'NULL/undefined'}`);
      addLog('debug', `      Проверка userId (из contactId): ${userId}`);
      
      // Извлекаем номер телефона из контакта WhatsApp API
      // ВАЖНО: Используем только реальные номера из contact.number или contact.id.user
      // НЕ используем длинные WhatsApp ID как номера!
      let phone = null;
      
      // Приоритет 1: contact.number - это ОСНОВНОЙ источник реального номера из WhatsApp API
      if (contact.number) {
        // Проверяем, что это не WhatsApp ID (длинная строка > 15 символов)
        if (!isWhatsAppId(contact.number)) {
          phone = formatPhoneNumber(contact.number);
          if (phone) {
            addLog('info', `   ✅ Найденный номер телефона: "${phone}" (из contact.number - WhatsApp API)`);
          } else {
            addLog('warn', `   ⚠️ contact.number существует, но не удалось отформатировать: "${contact.number}"`);
          }
        } else {
          addLog('warn', `   ⚠️ contact.number является WhatsApp ID (${contact.number.length} символов), пропускаем: "${contact.number}"`);
        }
      } else {
        addLog('debug', `   contact.number отсутствует или пустой`);
      }
      
      // Приоритет 2: contact.id.user - может содержать номер, если contact.number пустой
      if (!phone && contact.id?.user) {
        // Проверяем, что это не WhatsApp ID и похож на номер (10-15 цифр)
        if (!isWhatsAppId(contact.id.user) && /^\d+$/.test(contact.id.user) && contact.id.user.length >= 10 && contact.id.user.length <= 15) {
          phone = formatPhoneNumber(contact.id.user);
          if (phone) {
            addLog('info', `   ✅ Найденный номер телефона: "${phone}" (из contact.id.user - WhatsApp API)`);
          }
        } else {
          addLog('debug', `   contact.id.user не является номером: "${contact.id.user}" (длина: ${contact.id.user.length})`);
        }
      }
      
      // Приоритет 3: Пытаемся извлечь номер из WhatsApp ID (формат: номер@c.us)
      // ТОЛЬКО если это формат номер@c.us, а не длинный ID
      if (!phone && formattedId && formattedId.includes('@c.us')) {
        phone = extractPhoneFromWhatsAppId(formattedId);
        if (phone) {
          addLog('info', `   ✅ Найденный номер телефона: "${phone}" (извлечен из WhatsApp ID формата номер@c.us)`);
        }
      }
      
      // НЕ используем userId как номер, если он длинный (это WhatsApp ID, а не номер)
      // Если ничего не подошло
      if (!phone) {
        addLog('warn', `   ⚠️ Не удалось получить реальный номер телефона из WhatsApp API`);
        addLog('warn', `      contact.number: ${contact.number || 'NULL'} ${contact.number && isWhatsAppId(contact.number) ? '(это WhatsApp ID, не номер!)' : ''}`);
        addLog('warn', `      contact.id.user: ${contact.id?.user || 'NULL'} ${contact.id?.user && isWhatsAppId(contact.id.user) ? '(это WhatsApp ID, не номер!)' : ''}`);
        addLog('warn', `      formattedId: ${formattedId}`);
        addLog('warn', `      userId: ${userId} ${isWhatsAppId(userId) ? '(это WhatsApp ID, не номер!)' : ''}`);
        addLog('warn', `      РЕШЕНИЕ: Нужно найти контакт в WhatsApp, чтобы получить реальный номер через contact.number`);
      }
      
      // Детальное логирование имени
      addLog('info', `   🔍 Поиск имени:`);
      addLog('debug', `      Проверка contact.name: ${contact.name || 'NULL/undefined'}`);
      addLog('debug', `      Проверка contact.pushname: ${contact.pushname || 'NULL/undefined'}`);
      
      const pushname = contact.pushname || null;
      const name = contact.name || pushname || null;
      
      addLog('info', `   ✅ Найденное имя: "${name || pushname || 'не указано'}"`);
      addLog('info', `      Источник: ${contact.name ? 'contact.name' : (pushname ? 'contact.pushname' : 'не найдено')}`);
      
      // Детальное логирование WhatsApp ID
      addLog('info', `   🔍 Поиск WhatsApp ID:`);
      addLog('debug', `      Проверка contact.id?._serialized: ${contact.id?._serialized || 'NULL/undefined'}`);
      addLog('debug', `      Использование formattedId: ${formattedId}`);
      
      const whatsappId = contact.id?._serialized || formattedId;
      
      addLog('info', `   ✅ WhatsApp ID: "${whatsappId}"`);
      addLog('info', `      Источник: ${contact.id?._serialized ? 'contact.id._serialized' : 'formattedId'}`);

      addLog('info', `✅✅✅ ИТОГОВАЯ ИНФОРМАЦИЯ О КОНТАКТЕ ✅✅✅`);
      addLog('info', `   📞 Номер телефона: "${phone}"`);
      addLog('info', `   👤 Имя: "${name || pushname || 'не указано'}"`);
      addLog('info', `   📛 Pushname: "${pushname || 'не указано'}"`);
      addLog('info', `   🆔 WhatsApp ID: "${whatsappId}"`);

      return {
        phone: phone,
        name: name || pushname || phone,
        pushname: pushname,
        whatsappId: whatsappId
      };
    } catch (error) {
      addLog('error', `❌ Ошибка извлечения данных контакта: ${error.message}`);
      addLog('error', `   Stack trace: ${error.stack}`);
      throw error;
    }
  }

  // Способ 4: Ищем в БД WhatsApp сервиса (из истории сообщений)
  if (!contact) {
    try {
      addLog('debug', `   Попытка 4: Поиск в БД WhatsApp сервиса`);
      const dbContact = await getContactInfoFromDatabase(contactId);
      if (dbContact) {
        addLog('info', `   ✅ Контакт найден в БД: ${dbContact.name} (${dbContact.phone})`);
        return dbContact;
      }
    } catch (error) {
      lastError = error;
      addLog('debug', `   ⚠️ Ошибка поиска в БД: ${error.message}`);
    }
  }

  // Если контакт не найден, возвращаем базовую информацию из ID
  addLog('warn', `⚠️⚠️⚠️ КОНТАКТ НЕ НАЙДЕН НИ ОДНИМ СПОСОБОМ ⚠️⚠️⚠️`);
  addLog('warn', `   Искомый contactId: "${contactId}"`);
  addLog('warn', `   Искомый formattedId: "${formattedId}"`);
  addLog('warn', `   Искомый userId: "${userId}"`);
  addLog('warn', `   Попытки поиска: 5 способов (getContactById, список контактов, личные чаты, участники групп, БД)`);
  if (lastError) {
    addLog('warn', `   Последняя ошибка: ${lastError.message}`);
    if (lastError.stack) {
      addLog('warn', `   Stack trace: ${lastError.stack}`);
    }
  }
  addLog('warn', `   Рекомендация: Проверьте, что контакт существует в WhatsApp и доступен для поиска`);
  
  // Пытаемся извлечь номер телефона из ID
  addLog('info', `📞📞📞 ПОПЫТКА ИЗВЛЕЧЕНИЯ НОМЕРА ТЕЛЕФОНА ИЗ ID 📞📞📞`);
  addLog('debug', `   userId из contactId: "${userId}"`);
  addLog('debug', `   formattedId: "${formattedId}"`);
  addLog('debug', `   Длина userId: ${userId.length}`);
  
  // Пытаемся извлечь номер из WhatsApp ID
  let phoneFromId = extractPhoneFromWhatsAppId(formattedId);
  
  // Если не удалось извлечь из formattedId, пробуем userId
  if (!phoneFromId && userId) {
    phoneFromId = extractPhoneFromWhatsAppId(userId);
  }
  
  // Если userId не является WhatsApp ID, пробуем форматировать его как номер
  if (!phoneFromId && userId && !isWhatsAppId(userId)) {
    phoneFromId = formatPhoneNumber(userId);
  }
  
  // Если ничего не получилось
  if (!phoneFromId) {
    addLog('warn', `   ⚠️ Не удалось извлечь нормальный номер телефона из ID`);
    addLog('warn', `   userId="${userId}" (${userId.length} символов)`);
    addLog('warn', `   formattedId="${formattedId}"`);
    addLog('warn', `   Это WhatsApp ID, а не номер телефона. Нужно получить номер через WhatsApp API.`);
    return null; // Возвращаем null, чтобы система знала, что номер не найден
  }
  
  // Форматируем номер в международный формат (если еще не отформатирован)
  phoneFromId = formatPhoneNumber(phoneFromId);
  
  if (phoneFromId) {
    addLog('info', `   ✅ Извлечен и отформатирован номер: "${phoneFromId}"`);
    addLog('warn', `   ⚠️ Имя не найдено, используем номер телефона как имя`);
    return {
      phone: phoneFromId,
      name: phoneFromId, // Используем номер как имя, если имя не найдено
      pushname: null,
      whatsappId: formattedId
    };
  }
  
  // Если даже номер не удалось извлечь
  addLog('error', `❌❌❌ НЕ УДАЛОСЬ ИЗВЛЕЧЬ НОМЕР ТЕЛЕФОНА ИЗ ID ❌❌❌`);
  addLog('error', `   userId: "${userId}"`);
  addLog('error', `   Длина userId: ${userId.length}`);
  addLog('error', `   Требуется длина > 10 для валидного номера`);
  if (lastError) {
    addLog('error', `   Последняя ошибка: ${lastError.message}`);
  }
  
  return null;
}

/**
 * Проверяет, является ли строка WhatsApp ID (длинный числовой ID, а не номер телефона)
 */
function isWhatsAppId(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }
  
  const cleaned = str.trim();
  
  // Если это длинный числовой ID (больше 15 символов) - это WhatsApp ID
  if (cleaned.length > 15 && /^\d+$/.test(cleaned)) {
    return true;
  }
  
  // Если содержит @ и длина больше 20 - это WhatsApp ID
  if (cleaned.includes('@') && cleaned.length > 20) {
    return true;
  }
  
  return false;
}

/**
 * Форматирует номер телефона в международный формат (+7...)
 * @param {string} phone - Номер телефона (может быть с кодом страны или без)
 * @returns {string|null} - Отформатированный номер в формате +7XXXXXXXXXX
 */
export function formatPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  
  // Убираем все нецифровые символы
  const digits = phone.replace(/\D/g, '');
  
  // Если пусто, возвращаем null
  if (!digits || digits.length === 0) {
    return null;
  }
  
  // Если номер начинается с 8, заменяем на 7
  let formatted = digits;
  if (formatted.startsWith('8') && formatted.length === 11) {
    formatted = '7' + formatted.substring(1);
  }
  
  // Если номер начинается с 7 и длина 11, добавляем +
  if (formatted.startsWith('7') && formatted.length === 11) {
    return '+' + formatted;
  }
  
  // Если номер не начинается с 7, но длина 10, добавляем +7
  if (formatted.length === 10 && !formatted.startsWith('7')) {
    return '+7' + formatted;
  }
  
  // Если уже в правильном формате, возвращаем как есть
  if (formatted.startsWith('+7') && formatted.length === 12) {
    return formatted;
  }
  
  // Если начинается с +7 и длина 13, возвращаем как есть
  if (formatted.startsWith('+7') && formatted.length === 13) {
    return formatted;
  }
  
  // Если ничего не подошло, но номер начинается с 7 и длина 11, добавляем +
  if (formatted.startsWith('7') && formatted.length === 11) {
    return '+' + formatted;
  }
  
  // Если ничего не подошло, возвращаем исходный номер с +
  return '+' + formatted;
}

/**
 * Извлекает номер телефона из WhatsApp ID
 * @param {string} whatsappId - WhatsApp ID (может быть в формате номер@c.us или длинный ID)
 * @returns {string|null} - Номер телефона или null, если не удалось извлечь
 */
function extractPhoneFromWhatsAppId(whatsappId) {
  if (!whatsappId || typeof whatsappId !== 'string') {
    return null;
  }
  
  // Если это формат номер@c.us, извлекаем номер
  if (whatsappId.includes('@c.us')) {
    const phone = whatsappId.split('@')[0];
    // Проверяем, что это похоже на номер (10-15 цифр)
    if (phone && /^\d+$/.test(phone) && phone.length >= 10 && phone.length <= 15) {
      return formatPhoneNumber(phone);
    }
  }
  
  // Если это просто длинная строка цифр, проверяем длину
  const digits = whatsappId.replace(/\D/g, '');
  if (digits && /^\d+$/.test(digits)) {
    // Если длина 10-15, это может быть номер
    if (digits.length >= 10 && digits.length <= 15) {
      return formatPhoneNumber(digits);
    }
    // Если длина больше 15, это WhatsApp ID, а не номер
    if (digits.length > 15) {
      return null;
    }
  }
  
  return null;
}

/**
 * Тестирует разные методы получения номера телефона из WhatsApp ID
 * @param {string} [whatsappId] - WhatsApp ID для тестирования (если не указан, берется первый из БД)
 * @returns {Promise<Object>} Результаты тестирования всех методов
 */
export async function testContactRetrievalMethods(whatsappId = null) {
  const logs = [];
  
  function addTestLog(level, message) {
    logs.push({ level, message, timestamp: new Date().toISOString() });
    if (level === 'error') {
      logger.error(message);
    } else if (level === 'warn') {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  }
  
  addLog('info', '═'.repeat(80));
  addLog('info', '🧪 ТЕСТИРОВАНИЕ МЕТОДОВ ПОЛУЧЕНИЯ НОМЕРА ТЕЛЕФОНА');
  addLog('info', '═'.repeat(80));
  
  // 1. Получаем WhatsApp ID из базы данных, если не указан
  if (!whatsappId) {
    addLog('info', '📋 Получение WhatsApp ID из базы данных...');
    await initSpringBootDatabase();
    
    const result = await springBootPool.query(`
      SELECT id, seller_name, seller_phone
      FROM offers
      WHERE (LENGTH(seller_name) > 12 AND seller_name ~ '^[0-9]+$')
         OR (LENGTH(seller_phone) > 12 AND seller_phone ~ '^[0-9]+$')
      ORDER BY id DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      throw new Error('Не найдено предложений с WhatsApp ID в базе данных');
    }
    
    const offer = result.rows[0];
    if (isWhatsAppId(offer.seller_name)) {
      whatsappId = offer.seller_name;
    } else if (isWhatsAppId(offer.seller_phone)) {
      whatsappId = offer.seller_phone;
    }
    
    if (!whatsappId) {
      throw new Error('Не удалось определить WhatsApp ID из предложения');
    }
    
    addLog('info', `✅ Найден WhatsApp ID: ${whatsappId} (предложение ID: ${offer.id})`);
  } else {
    addLog('info', `📋 Используется указанный WhatsApp ID: ${whatsappId}`);
  }
  
  const client = getClient();
  if (!client) {
    throw new Error('WhatsApp клиент не инициализирован');
  }
  
  const status = client.info;
  if (!status || !status.wid) {
    throw new Error('WhatsApp клиент не готов');
  }
  
  addLog('info', `✅ WhatsApp клиент готов: ${status.pushname} (${status.wid.user})`);
  
  let formattedId = whatsappId;
  if (!whatsappId.includes('@')) {
    formattedId = `${whatsappId}@c.us`;
  }
  const userId = whatsappId.split('@')[0];
  
  const results = [];
  
  // МЕТОД 1: getContactById
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'МЕТОД 1: getContactById');
  addLog('info', '═'.repeat(80));
  try {
    if (typeof client.getContactById === 'function') {
      const contact = await client.getContactById(formattedId);
      addLog('info', `✅ Контакт найден через getContactById`);
      addLog('info', `   contact.number: ${contact.number || 'NULL'}`);
      addLog('info', `   contact.id?.user: ${contact.id?.user || 'NULL'}`);
      addLog('info', `   contact.name: ${contact.name || 'NULL'}`);
      addLog('info', `   contact.pushname: ${contact.pushname || 'NULL'}`);
      
      if (contact.number && !isWhatsAppId(contact.number)) {
        const phone = formatPhoneNumber(contact.number);
        addLog('info', `   ✅✅✅ НОМЕР ТЕЛЕФОНА: ${phone} ✅✅✅`);
        results.push({ success: true, phone, method: 'getContactById', contact });
      } else {
        addLog('warn', `   ⚠️ contact.number является WhatsApp ID или пустой`);
        results.push({ success: false, method: 'getContactById', reason: 'contact.number is WhatsApp ID or empty' });
      }
    } else {
      addLog('warn', `❌ client.getContactById не доступен`);
      results.push({ success: false, method: 'getContactById', reason: 'method not available' });
    }
  } catch (error) {
    addLog('error', `❌ Ошибка: ${error.message}`);
    results.push({ success: false, method: 'getContactById', error: error.message });
  }
  
  // МЕТОД 2: getContacts
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'МЕТОД 2: getContacts (поиск в списке всех контактов)');
  addLog('info', '═'.repeat(80));
  try {
    const contacts = await client.getContacts();
    addLog('info', `Всего контактов: ${contacts.length}`);
    
    const found = contacts.find(c => {
      try {
        const cId = c.id?._serialized || '';
        const cUser = c.id?.user || '';
        const cNumber = c.number || '';
        return cId === formattedId || cId === whatsappId || cUser === userId || cNumber === userId || cNumber === whatsappId;
      } catch (e) {
        return false;
      }
    });
    
    if (found) {
      addLog('info', `✅ Контакт найден в списке контактов`);
      addLog('info', `   contact.number: ${found.number || 'NULL'}`);
      addLog('info', `   contact.id?.user: ${found.id?.user || 'NULL'}`);
      addLog('info', `   contact.name: ${found.name || 'NULL'}`);
      addLog('info', `   contact.pushname: ${found.pushname || 'NULL'}`);
      
      if (found.number && !isWhatsAppId(found.number)) {
        const phone = formatPhoneNumber(found.number);
        addLog('info', `   ✅✅✅ НОМЕР ТЕЛЕФОНА: ${phone} ✅✅✅`);
        results.push({ success: true, phone, method: 'getContacts', contact: found });
      } else {
        addLog('warn', `   ⚠️ contact.number является WhatsApp ID или пустой`);
        results.push({ success: false, method: 'getContacts', reason: 'contact.number is WhatsApp ID or empty' });
      }
    } else {
      addLog('warn', `❌ Контакт не найден в списке контактов`);
      results.push({ success: false, method: 'getContacts', reason: 'contact not found in list' });
    }
  } catch (error) {
    addLog('error', `❌ Ошибка: ${error.message}`);
    results.push({ success: false, method: 'getContacts', error: error.message });
  }
  
  // МЕТОД 3: Поиск в участниках всех групп
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'МЕТОД 3: Поиск в участниках всех групп');
  addLog('info', '═'.repeat(80));
  try {
    const chats = await client.getChats();
    addLog('info', `Всего чатов: ${chats.length}`);
    
    const groupChats = chats.filter(c => c.isGroup);
    addLog('info', `Групповых чатов: ${groupChats.length}`);
    
    for (let i = 0; i < groupChats.length; i++) {
      const chat = groupChats[i];
      try {
        addLog('info', `\n   Проверка группы ${i + 1}/${groupChats.length}: "${chat.name}"`);
        addLog('info', `   Chat ID: ${chat.id?._serialized || 'unknown'}`);
        
        const participants = await chat.participants;
        addLog('info', `   Участников в группе: ${participants.length}`);
        
        // Логируем первые несколько участников для отладки (только в первой группе)
        if (i === 0 && participants.length > 0) {
          addLog('info', `   Примеры ID участников (первые 5):`);
          participants.slice(0, 5).forEach((p, idx) => {
            const pId = p.id?._serialized || 'NULL';
            const pUser = p.id?.user || 'NULL';
            const pNumber = p.number || 'NULL';
            addLog('info', `      ${idx + 1}. _serialized: "${pId}", user: "${pUser}", number: "${pNumber}"`);
          });
          addLog('info', `   Ищем: whatsappId="${whatsappId}", userId="${userId}", formattedId="${formattedId}"`);
        }
        
        const found = participants.find(p => {
          const pId = p.id?._serialized || '';
          const pUser = p.id?.user || '';
          const pNumber = p.number || '';
          
          // Убираем суффиксы для сравнения
          const pIdClean = pId.replace('@c.us', '').replace('@g.us', '');
          const userIdClean = userId.replace('@c.us', '').replace('@g.us', '');
          const whatsappIdClean = whatsappId.replace('@c.us', '').replace('@g.us', '');
          
          // Сравниваем разные варианты ID
          const matches = 
            pId === formattedId || 
            pId === whatsappId ||
            pIdClean === userId ||
            pIdClean === userIdClean ||
            pIdClean === whatsappId ||
            pIdClean === whatsappIdClean ||
            pUser === userId ||
            pUser === userIdClean ||
            pUser === whatsappId ||
            pUser === whatsappIdClean ||
            pNumber === userId ||
            pNumber === userIdClean ||
            pNumber === whatsappId ||
            pNumber === whatsappIdClean;
          
          if (matches) {
            addLog('debug', `      ✅✅✅ СОВПАДЕНИЕ НАЙДЕНО! ✅✅✅`);
            addLog('debug', `         p.id._serialized: "${pId}"`);
            addLog('debug', `         p.id.user: "${pUser}"`);
            addLog('debug', `         p.number: "${pNumber}"`);
            addLog('debug', `         pIdClean: "${pIdClean}"`);
            addLog('debug', `         Искомый whatsappId: "${whatsappId}"`);
            addLog('debug', `         Искомый userId: "${userId}"`);
            addLog('debug', `         Искомый formattedId: "${formattedId}"`);
            addLog('debug', `         userIdClean: "${userIdClean}"`);
            addLog('debug', `         whatsappIdClean: "${whatsappIdClean}"`);
          }
          
          return matches;
        });
        
        if (found) {
          addLog('info', `   ✅✅✅ КОНТАКТ НАЙДЕН В ГРУППЕ "${chat.name}" ✅✅✅`);
          addLog('info', `   contact.number: ${found.number || 'NULL'}`);
          addLog('info', `   contact.id?.user: ${found.id?.user || 'NULL'}`);
          addLog('info', `   contact.name: ${found.name || 'NULL'}`);
          addLog('info', `   contact.pushname: ${found.pushname || 'NULL'}`);
          
          if (found.number && !isWhatsAppId(found.number)) {
            const phone = formatPhoneNumber(found.number);
            addLog('info', `   ✅✅✅ НОМЕР ТЕЛЕФОНА: ${phone} ✅✅✅`);
            results.push({ success: true, phone, method: 'groupParticipants', contact: found, groupName: chat.name });
            break; // Нашли, прекращаем поиск
          } else {
            addLog('warn', `   ⚠️ contact.number является WhatsApp ID или пустой, продолжаем поиск...`);
          }
        }
      } catch (error) {
        addLog('debug', `   ⚠️ Ошибка проверки группы "${chat.name}": ${error.message}`);
      }
    }
    
    if (!results.some(r => r.method === 'groupParticipants' && r.success)) {
      addLog('warn', `❌ Контакт не найден ни в одной группе`);
      results.push({ success: false, method: 'groupParticipants', reason: 'contact not found in any group' });
    }
  } catch (error) {
    addLog('error', `❌ Ошибка: ${error.message}`);
    results.push({ success: false, method: 'groupParticipants', error: error.message });
  }
  
  // МЕТОД 4: Поиск через личные чаты
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'МЕТОД 4: Поиск в личных чатах');
  addLog('info', '═'.repeat(80));
  try {
    const chats = await client.getChats();
    const personalChats = chats.filter(c => !c.isGroup);
    addLog('info', `Личных чатов: ${personalChats.length}`);
    
    for (const chat of personalChats) {
      const chatId = chat.id?._serialized || '';
      if (chatId === formattedId || chatId === whatsappId) {
        addLog('info', `✅ Найден личный чат: ${chatId}`);
        try {
          const contact = await chat.getContact();
          addLog('info', `   contact.number: ${contact.number || 'NULL'}`);
          addLog('info', `   contact.id?.user: ${contact.id?.user || 'NULL'}`);
          addLog('info', `   contact.name: ${contact.name || 'NULL'}`);
          addLog('info', `   contact.pushname: ${contact.pushname || 'NULL'}`);
          
          if (contact.number && !isWhatsAppId(contact.number)) {
            const phone = formatPhoneNumber(contact.number);
            addLog('info', `   ✅✅✅ НОМЕР ТЕЛЕФОНА: ${phone} ✅✅✅`);
            results.push({ success: true, phone, method: 'personalChats', contact });
            break;
          }
        } catch (error) {
          addLog('warn', `   ⚠️ Ошибка получения контакта из чата: ${error.message}`);
        }
      }
    }
    
    if (!results.some(r => r.method === 'personalChats' && r.success)) {
      addLog('warn', `❌ Личный чат не найден`);
      results.push({ success: false, method: 'personalChats', reason: 'personal chat not found' });
    }
  } catch (error) {
    addLog('error', `❌ Ошибка: ${error.message}`);
    results.push({ success: false, method: 'personalChats', error: error.message });
  }
  
  // МЕТОД 5: Поиск в последних сообщениях групп
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'МЕТОД 5: Поиск в последних сообщениях групп');
  addLog('info', '═'.repeat(80));
  try {
    const chats = await client.getChats();
    const groupChats = chats.filter(c => c.isGroup);
    addLog('info', `Всего групп: ${groupChats.length}`);
    
    let foundInMessages = null;
    for (let i = 0; i < Math.min(groupChats.length, 5); i++) { // Проверяем первые 5 групп
      const chat = groupChats[i];
      try {
        addLog('info', `\n   Проверка группы ${i + 1}: "${chat.name}"`);
        const messages = await chat.fetchMessages({ limit: 50 });
        addLog('info', `   Найдено сообщений: ${messages.length}`);
        
        for (const msg of messages) {
          const msgFrom = msg.from || msg.author || (msg.id && msg.id.remote) || '';
          const msgUserId = msgFrom.split('@')[0];
          
          const matches = 
            msgFrom === formattedId ||
            msgFrom === whatsappId ||
            msgUserId === userId ||
            msgFrom.includes(userId) ||
            msgFrom.includes(whatsappId);
          
          if (matches) {
            addLog('info', `   ✅✅✅ НАЙДЕНО СООБЩЕНИЕ ОТ ИСКОМОГО КОНТАКТА! ✅✅✅`);
            addLog('info', `      msg.from: "${msgFrom}"`);
            
            try {
              const msgContact = await msg.getContact();
              if (msgContact && msgContact.number && !isWhatsAppId(msgContact.number)) {
                const phone = formatPhoneNumber(msgContact.number);
                if (phone) {
                  addLog('info', `      ✅✅✅ НОМЕР ТЕЛЕФОНА: ${phone} ✅✅✅`);
                  results.push({ success: true, phone, method: 'groupMessages', contact: msgContact, groupName: chat.name });
                  if (!foundPhone) foundPhone = phone;
                  foundInMessages = msgContact;
                  break;
                }
              }
            } catch (contactError) {
              // Используем данные из сообщения
              const notifyName = msg.notifyName || msg.pushName || msg.fromName || msgUserId;
              const phone = formatPhoneNumber(msgUserId);
              if (phone && !isWhatsAppId(msgUserId)) {
                addLog('info', `      ✅✅✅ НОМЕР ТЕЛЕФОНА (из userId): ${phone} ✅✅✅`);
                results.push({ success: true, phone, method: 'groupMessages', contact: { number: phone, name: notifyName }, groupName: chat.name });
                if (!foundPhone) foundPhone = phone;
                foundInMessages = { number: phone, name: notifyName };
                break;
              }
            }
          }
        }
        
        if (foundInMessages) break;
      } catch (error) {
        addLog('error', `❌ Ошибка при проверке группы "${chat.name}": ${error.message}`);
      }
    }
    
    if (!foundInMessages) {
      addLog('warn', `❌ Контакт не найден в последних сообщениях групп`);
      results.push({ success: false, method: 'groupMessages', reason: 'contact not found in group messages' });
    }
  } catch (error) {
    addLog('error', `❌ Критическая ошибка при поиске в сообщениях групп: ${error.message}`);
    results.push({ success: false, method: 'groupMessages', error: error.message });
  }
  
  // МЕТОД 6: Поиск в БД WhatsApp сервиса (из истории сообщений)
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'МЕТОД 6: Поиск в БД WhatsApp сервиса');
  addLog('info', '═'.repeat(80));
  try {
    const dbContact = await getContactInfoFromDatabase(whatsappId);
    if (dbContact && dbContact.phone) {
      addLog('info', `✅ Контакт найден в БД: ${dbContact.name} (${dbContact.phone})`);
      addLog('info', `   ✅✅✅ НОМЕР ТЕЛЕФОНА: ${dbContact.phone} ✅✅✅`);
      results.push({ success: true, phone: dbContact.phone, method: 'database', contact: dbContact });
      if (!foundPhone) foundPhone = dbContact.phone;
    } else {
      addLog('warn', `❌ Контакт не найден в БД WhatsApp сервиса или номер не извлечен`);
      results.push({ success: false, method: 'database', reason: 'contact not found in DB or phone not extracted' });
    }
  } catch (error) {
    addLog('error', `❌ Ошибка при поиске в БД: ${error.message}`);
    results.push({ success: false, method: 'database', error: error.message });
  }
  
  // Итоговый отчет
  addLog('info', '\n' + '═'.repeat(80));
  addLog('info', 'ИТОГОВЫЙ ОТЧЕТ');
  addLog('info', '═'.repeat(80));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  addLog('info', `\nУспешные методы: ${successful.length}`);
  successful.forEach(r => {
    addLog('info', `   ✅ ${r.method}: ${r.phone}`);
    if (r.groupName) {
      addLog('info', `      Найден в группе: ${r.groupName}`);
    }
  });
  
  addLog('info', `\nНеудачные методы: ${failed.length}`);
  failed.forEach(r => {
    addLog('warn', `   ❌ ${r.method}: ${r.reason || r.error || 'unknown error'}`);
  });
  
  if (successful.length > 0) {
    const bestResult = successful[0];
    addLog('info', `\n✅✅✅ РАБОЧИЙ СПОСОБ НАЙДЕН ✅✅✅`);
    addLog('info', `   Метод: ${bestResult.method}`);
    addLog('info', `   Номер телефона: ${bestResult.phone}`);
    if (bestResult.groupName) {
      addLog('info', `   Группа: ${bestResult.groupName}`);
    }
  } else {
    addLog('error', `\n❌❌❌ НИ ОДИН МЕТОД НЕ СРАБОТАЛ ❌❌❌`);
  }
  
  return {
    whatsappId,
    results,
    successful: successful.length,
    failed: failed.length,
    bestMethod: successful.length > 0 ? successful[0].method : null,
    phone: successful.length > 0 ? successful[0].phone : null
  };
}

/**
 * Восстанавливает информацию о продавцах
 */
export async function restoreSellers() {
  addLog('info', '═'.repeat(80));
  addLog('info', '📋 ВОССТАНОВЛЕНИЕ ИНФОРМАЦИИ О ПРОДАВЦАХ');
  addLog('info', '═'.repeat(80));

  try {
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
    addLog('info', `📊 Найдено продавцов для восстановления: ${sellers.length}`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const seller of sellers) {
      try {
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

        const contactInfo = await getContactInfo(whatsappId);

        if (!contactInfo) {
          failed++;
          continue;
        }

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
          
          addLog('info', `✅ ID=${seller.id}: "${seller.name}" → "${contactInfo.name}", "${seller.phone}" → "${contactInfo.phone}"`);
          updated++;
        } else {
          skipped++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        addLog('error', `❌ Ошибка продавца ID=${seller.id}: ${error.message}`);
        failed++;
      }
    }

    addLog('info', '═'.repeat(80));
    addLog('info', `📊 РЕЗУЛЬТАТЫ: Обновлено=${updated}, Пропущено=${skipped}, Ошибок=${failed}`);
    addLog('info', '═'.repeat(80));

    return { updated, skipped, failed, total: sellers.length };

  } catch (error) {
    addLog('error', `❌ Ошибка восстановления продавцов: ${error.message}`);
    throw error;
  }
}

/**
 * Получает список предложений, которые нужно восстановить
 */
export async function getOffersToRestore(limit = 1000) {
  try {
    addLog('debug', `🔍 Получение списка предложений для восстановления (лимит: ${limit})`);
    
    await initSpringBootDatabase();
    
    if (!springBootPool) {
      throw new Error('Не удалось инициализировать подключение к базе данных Spring Boot');
    }
    
    addLog('debug', `   Выполнение SQL запроса...`);
    
    const result = await springBootPool.query(`
      SELECT id, seller_name, seller_phone, operation_type, price, quantity, currency,
             source_chat_name, source_message_id, created_at
      FROM offers
      WHERE (LENGTH(seller_name) > 12 AND seller_name ~ '^[0-9]+$')
         OR (LENGTH(seller_phone) > 12 AND seller_phone ~ '^[0-9]+$')
      ORDER BY id DESC
      LIMIT $1
    `, [limit]);

    addLog('info', `✅ Найдено предложений для восстановления: ${result.rows.length}`);
    
    return result.rows;
  } catch (error) {
    addLog('error', `❌ Ошибка получения списка предложений: ${error.message}`);
    addLog('error', `   Stack trace: ${error.stack}`);
    logger.error(`Ошибка getOffersToRestore: ${error.message}`, error);
    throw error;
  }
}

/**
 * Восстанавливает одно предложение по ID
 */
export async function restoreSingleOffer(offerId) {
  try {
    await initSpringBootDatabase();
    
    // Получаем предложение
    const result = await springBootPool.query(`
      SELECT id, seller_name, seller_phone
      FROM offers
      WHERE id = $1
    `, [offerId]);

    if (result.rows.length === 0) {
      throw new Error(`Предложение с ID ${offerId} не найдено`);
    }

    const offer = result.rows[0];
    
    // Определяем WhatsApp ID
    let whatsappId = null;
    
    if (isWhatsAppId(offer.seller_name)) {
      whatsappId = offer.seller_name;
    } else if (isWhatsAppId(offer.seller_phone)) {
      whatsappId = offer.seller_phone;
    } else {
      throw new Error('Не удалось определить WhatsApp ID для этого предложения');
    }

    addLog('info', `🔍 Восстановление предложения ID=${offer.id}, WhatsApp ID=${whatsappId}`);

    // Получаем информацию о контакте
    let contactInfo = null;
    try {
      contactInfo = await getContactInfo(whatsappId);
    } catch (error) {
      addLog('warn', `⚠️ Ошибка получения контакта: ${error.message}`);
    }

    // Если контакт не найден, но есть номер из ID, используем его для частичного восстановления
    if (!contactInfo) {
      const phoneFromId = whatsappId.split('@')[0];
      if (phoneFromId && phoneFromId.length > 10) {
        addLog('warn', `⚠️ Контакт не найден в WhatsApp, используем номер из ID: ${phoneFromId}`);
        
        // Обновляем только телефон, имя оставляем как есть или ставим null
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (isWhatsAppId(offer.seller_phone) || offer.seller_phone === whatsappId || !offer.seller_phone) {
          updateFields.push(`seller_phone = $${paramIndex}`);
          updateValues.push(phoneFromId);
          paramIndex++;
        }

        // Если имя тоже WhatsApp ID, используем номер телефона как имя
        if (isWhatsAppId(offer.seller_name) || offer.seller_name === whatsappId) {
          updateFields.push(`seller_name = $${paramIndex}`);
          updateValues.push(phoneFromId); // Используем номер как имя, если имя не найдено
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
          
          addLog('info', `✅ Предложение ID=${offer.id} частично восстановлено: телефон "${offer.seller_phone}" → "${phoneFromId}", имя "${offer.seller_name}" → "${phoneFromId}"`);
          
          return {
            success: true,
            offerId: offer.id,
            oldName: offer.seller_name,
            newName: phoneFromId, // Используем номер как имя, если имя не найдено
            oldPhone: offer.seller_phone,
            newPhone: phoneFromId,
            partial: true,
            message: 'Восстановлен номер телефона, имя установлено как номер телефона'
          };
        }
      }
      
      // Если даже номер не удалось извлечь, выбрасываем ошибку
      throw new Error(`Не удалось получить информацию о контакте для WhatsApp ID: ${whatsappId}. Контакт не найден в WhatsApp и в БД WhatsApp сервиса.`);
    }

    // Обновляем запись
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
      // Используем имя, если есть, иначе номер телефона
      const phoneFromId = whatsappId.split('@')[0];
      updateValues.push(contactInfo.name || contactInfo.phone || phoneFromId);
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
      
      addLog('info', `✅ Предложение ID=${offer.id} восстановлено: "${offer.seller_name}" → "${contactInfo.name}", "${offer.seller_phone}" → "${contactInfo.phone}"`);
      
      return {
        success: true,
        offerId: offer.id,
        oldName: offer.seller_name,
        newName: contactInfo.name,
        oldPhone: offer.seller_phone,
        newPhone: contactInfo.phone
      };
    } else {
      throw new Error('Нет полей для обновления');
    }

  } catch (error) {
    addLog('error', `❌ Ошибка восстановления предложения ID=${offerId}: ${error.message}`);
    throw error;
  }
}

/**
 * Восстанавливает информацию в предложениях
 */
export async function restoreOffers() {
  addLog('info', '═'.repeat(80));
  addLog('info', '📋 ВОССТАНОВЛЕНИЕ ИНФОРМАЦИИ В ПРЕДЛОЖЕНИЯХ');
  addLog('info', '═'.repeat(80));

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
    addLog('info', `📊 Найдено предложений: ${offers.length}`);

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
          
          addLog('info', `✅ ID=${offer.id}: "${offer.seller_name}" → "${contactInfo.name}", "${offer.seller_phone}" → "${contactInfo.phone}"`);
          updated++;
        } else {
          skipped++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        addLog('error', `❌ Ошибка предложения ID=${offer.id}: ${error.message}`);
        failed++;
      }
    }

    addLog('info', '═'.repeat(80));
    addLog('info', `📊 РЕЗУЛЬТАТЫ: Обновлено=${updated}, Пропущено=${skipped}, Ошибок=${failed}`);
    addLog('info', '═'.repeat(80));

    return { updated, skipped, failed, total: offers.length };

  } catch (error) {
    addLog('error', `❌ Ошибка восстановления предложений: ${error.message}`);
    throw error;
  }
}

/**
 * Главная функция восстановления
 */
export async function startRestore(type = 'all') {
  try {
    clearRestoreLogs();
    
    addLog('info', '🚀 Запуск утилиты восстановления контактов...');
    addLog('info', '═'.repeat(80));

    const client = getClient();
    if (!client) {
      throw new Error('WhatsApp клиент не инициализирован. Убедитесь, что WhatsApp сервис запущен.');
    }

    const status = client.info;
    if (!status || !status.wid) {
      throw new Error('WhatsApp клиент не готов. Дождитесь подключения.');
    }

    addLog('info', '✅ WhatsApp клиент готов');
    addLog('info', `   Подключен как: ${status.pushname} (${status.wid.user})`);

    await initSpringBootDatabase();

    const results = {
      sellers: null,
      offers: null
    };

    if (type === 'sellers' || type === 'all') {
      try {
        results.sellers = await restoreSellers();
      } catch (error) {
        addLog('error', `Ошибка восстановления продавцов: ${error.message}`);
        results.sellers = { error: error.message };
      }
    }

    if (type === 'offers' || type === 'all') {
      try {
        results.offers = await restoreOffers();
      } catch (error) {
        addLog('error', `Ошибка восстановления предложений: ${error.message}`);
        results.offers = { error: error.message };
      }
    }

    addLog('info', '═'.repeat(80));
    addLog('info', '✅ Восстановление завершено!');
    addLog('info', '═'.repeat(80));

    return results;

  } catch (error) {
    addLog('error', `❌ Критическая ошибка: ${error.message}`);
    if (error.stack) {
      addLog('error', `Стек ошибки: ${error.stack}`);
    }
    throw error;
  }
}

