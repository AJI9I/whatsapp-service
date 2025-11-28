/**
 * Тестовый скрипт для проверки разных способов получения номера телефона из WhatsApp ID
 * Запуск: node test-contact-retrieval.js
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

dotenv.config({ path: join(__dirname, '.env') });

// Функция для получения конфигурации БД Spring Boot (копия из restore-contacts-service.js)
function parseJdbcUrl(jdbcUrl) {
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

function readSpringBootConfig() {
  try {
    const appYmlPath = join(__dirname, '..', 'shop-backend', 'src', 'main', 'resources', 'application.yml');
    if (fs.existsSync(appYmlPath)) {
      const fileContents = fs.readFileSync(appYmlPath, 'utf8');
      const config = yaml.load(fileContents);
      if (config?.spring?.datasource) {
        const ds = config.spring.datasource;
        let jdbcUrl = ds.url || '';
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

function getSpringBootDbConfig() {
  if (process.env.SPRING_DATASOURCE_URL) {
    const parsed = parseJdbcUrl(process.env.SPRING_DATASOURCE_URL);
    if (parsed) {
      return {
        ...parsed,
        user: process.env.SPRING_DATASOURCE_USERNAME || 'postgres',
        password: process.env.SPRING_DATASOURCE_PASSWORD || 'vasagaroot'
      };
    }
  }
  if (process.env.SPRING_DB_HOST) {
    return {
      host: process.env.SPRING_DB_HOST,
      port: parseInt(process.env.SPRING_DB_PORT || '5432'),
      database: process.env.SPRING_DB_NAME || 'miners',
      user: process.env.SPRING_DB_USER || 'postgres',
      password: process.env.SPRING_DB_PASSWORD || 'vasagaroot'
    };
  }
  const config = readSpringBootConfig();
  if (config) return config;
  return {
    host: 'localhost',
    port: 5432,
    database: 'miners',
    user: 'postgres',
    password: 'vasagaroot'
  };
}

const springBootDbConfig = getSpringBootDbConfig();
let springBootPool = null;

async function initSpringBootDatabase() {
  if (springBootPool) {
    try {
      await springBootPool.query('SELECT NOW()');
      return springBootPool;
    } catch (error) {
      logger.warn(`Соединение разорвано, переподключаемся: ${error.message}`);
      try {
        await springBootPool.end();
      } catch (e) {}
      springBootPool = null;
    }
  }
  try {
    springBootPool = new Pool(springBootDbConfig);
    await springBootPool.query('SELECT NOW()');
    return springBootPool;
  } catch (error) {
    logger.error(`Ошибка подключения к БД: ${error.message}`);
    throw error;
  }
}

function isWhatsAppId(str) {
  if (!str || typeof str !== 'string') return false;
  const cleaned = str.trim();
  if (cleaned.length > 15 && /^\d+$/.test(cleaned)) return true;
  if (cleaned.includes('@') && cleaned.length > 20) return true;
  return false;
}

function formatPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits || digits.length === 0) return null;
  let formatted = digits;
  if (formatted.startsWith('8') && formatted.length === 11) {
    formatted = '7' + formatted.substring(1);
  }
  if (formatted.startsWith('7') && formatted.length === 11) {
    return '+' + formatted;
  }
  if (formatted.length === 10 && !formatted.startsWith('7')) {
    return '+7' + formatted;
  }
  if (formatted.startsWith('+7') && formatted.length === 12) {
    return formatted;
  }
  if (formatted.startsWith('7') && formatted.length === 11) {
    return '+' + formatted;
  }
  return '+' + formatted;
}

/**
 * МЕТОД 1: getContactById
 */
async function method1_getContactById(client, whatsappId) {
  console.log('\n' + '='.repeat(80));
  console.log('МЕТОД 1: getContactById');
  console.log('='.repeat(80));
  console.log(`WhatsApp ID: ${whatsappId}`);
  
  try {
    let formattedId = whatsappId;
    if (!whatsappId.includes('@')) {
      formattedId = `${whatsappId}@c.us`;
    }
    
    console.log(`Попытка: client.getContactById("${formattedId}")`);
    
    if (typeof client.getContactById === 'function') {
      const contact = await client.getContactById(formattedId);
      console.log(`✅ Контакт найден через getContactById`);
      console.log(`   contact.number: ${contact.number || 'NULL'}`);
      console.log(`   contact.id?.user: ${contact.id?.user || 'NULL'}`);
      console.log(`   contact.id?._serialized: ${contact.id?._serialized || 'NULL'}`);
      console.log(`   contact.name: ${contact.name || 'NULL'}`);
      console.log(`   contact.pushname: ${contact.pushname || 'NULL'}`);
      
      if (contact.number && !isWhatsAppId(contact.number)) {
        const phone = formatPhoneNumber(contact.number);
        console.log(`   ✅ НОМЕР ТЕЛЕФОНА: ${phone}`);
        return { success: true, phone, method: 'getContactById', contact };
      } else {
        console.log(`   ⚠️ contact.number является WhatsApp ID или пустой`);
      }
    } else {
      console.log(`❌ client.getContactById не доступен`);
    }
  } catch (error) {
    console.log(`❌ Ошибка: ${error.message}`);
  }
  
  return { success: false, method: 'getContactById' };
}

/**
 * МЕТОД 2: Поиск в списке всех контактов
 */
async function method2_getContacts(client, whatsappId) {
  console.log('\n' + '='.repeat(80));
  console.log('МЕТОД 2: getContacts (поиск в списке всех контактов)');
  console.log('='.repeat(80));
  console.log(`WhatsApp ID: ${whatsappId}`);
  
  try {
    let formattedId = whatsappId;
    if (!whatsappId.includes('@')) {
      formattedId = `${whatsappId}@c.us`;
    }
    const userId = whatsappId.split('@')[0];
    
    console.log(`Получение списка всех контактов...`);
    const contacts = await client.getContacts();
    console.log(`Всего контактов: ${contacts.length}`);
    
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
      console.log(`✅ Контакт найден в списке контактов`);
      console.log(`   contact.number: ${found.number || 'NULL'}`);
      console.log(`   contact.id?.user: ${found.id?.user || 'NULL'}`);
      console.log(`   contact.id?._serialized: ${found.id?._serialized || 'NULL'}`);
      console.log(`   contact.name: ${found.name || 'NULL'}`);
      console.log(`   contact.pushname: ${found.pushname || 'NULL'}`);
      
      if (found.number && !isWhatsAppId(found.number)) {
        const phone = formatPhoneNumber(found.number);
        console.log(`   ✅ НОМЕР ТЕЛЕФОНА: ${phone}`);
        return { success: true, phone, method: 'getContacts', contact: found };
      } else {
        console.log(`   ⚠️ contact.number является WhatsApp ID или пустой`);
      }
    } else {
      console.log(`❌ Контакт не найден в списке контактов`);
    }
  } catch (error) {
    console.log(`❌ Ошибка: ${error.message}`);
  }
  
  return { success: false, method: 'getContacts' };
}

/**
 * МЕТОД 3: Поиск в участниках всех групп
 */
async function method3_groupParticipants(client, whatsappId) {
  console.log('\n' + '='.repeat(80));
  console.log('МЕТОД 3: Поиск в участниках всех групп');
  console.log('='.repeat(80));
  console.log(`WhatsApp ID: ${whatsappId}`);
  
  try {
    let formattedId = whatsappId;
    if (!whatsappId.includes('@')) {
      formattedId = `${whatsappId}@c.us`;
    }
    const userId = whatsappId.split('@')[0];
    
    console.log(`Получение списка всех чатов...`);
    const chats = await client.getChats();
    console.log(`Всего чатов: ${chats.length}`);
    
    const groupChats = chats.filter(c => c.isGroup);
    console.log(`Групповых чатов: ${groupChats.length}`);
    
    for (let i = 0; i < groupChats.length; i++) {
      const chat = groupChats[i];
      try {
        console.log(`\n   Проверка группы ${i + 1}/${groupChats.length}: "${chat.name}" (${chat.id?._serialized || 'unknown'})`);
        
        const participants = await chat.participants;
        console.log(`   Участников в группе: ${participants.length}`);
        
        const found = participants.find(p => {
          const pId = p.id?._serialized || '';
          const pUser = p.id?.user || '';
          const pNumber = p.number || '';
          return pId === formattedId || pId === whatsappId || pUser === userId || pNumber === userId || pNumber === whatsappId;
        });
        
        if (found) {
          console.log(`   ✅✅✅ КОНТАКТ НАЙДЕН В ГРУППЕ "${chat.name}" ✅✅✅`);
          console.log(`   contact.number: ${found.number || 'NULL'}`);
          console.log(`   contact.id?.user: ${found.id?.user || 'NULL'}`);
          console.log(`   contact.id?._serialized: ${found.id?._serialized || 'NULL'}`);
          console.log(`   contact.name: ${found.name || 'NULL'}`);
          console.log(`   contact.pushname: ${found.pushname || 'NULL'}`);
          
          if (found.number && !isWhatsAppId(found.number)) {
            const phone = formatPhoneNumber(found.number);
            console.log(`   ✅✅✅ НОМЕР ТЕЛЕФОНА: ${phone} ✅✅✅`);
            return { success: true, phone, method: 'groupParticipants', contact: found, groupName: chat.name };
          } else {
            console.log(`   ⚠️ contact.number является WhatsApp ID или пустой`);
            // Продолжаем поиск в других группах
          }
        }
      } catch (error) {
        console.log(`   ⚠️ Ошибка проверки группы "${chat.name}": ${error.message}`);
      }
    }
    
    console.log(`❌ Контакт не найден ни в одной группе`);
  } catch (error) {
    console.log(`❌ Ошибка: ${error.message}`);
  }
  
  return { success: false, method: 'groupParticipants' };
}

/**
 * МЕТОД 4: Поиск через личные чаты
 */
async function method4_personalChats(client, whatsappId) {
  console.log('\n' + '='.repeat(80));
  console.log('МЕТОД 4: Поиск в личных чатах');
  console.log('='.repeat(80));
  console.log(`WhatsApp ID: ${whatsappId}`);
  
  try {
    let formattedId = whatsappId;
    if (!whatsappId.includes('@')) {
      formattedId = `${whatsappId}@c.us`;
    }
    
    console.log(`Получение списка всех чатов...`);
    const chats = await client.getChats();
    console.log(`Всего чатов: ${chats.length}`);
    
    const personalChats = chats.filter(c => !c.isGroup);
    console.log(`Личных чатов: ${personalChats.length}`);
    
    for (const chat of personalChats) {
      const chatId = chat.id?._serialized || '';
      if (chatId === formattedId || chatId === whatsappId) {
        console.log(`✅ Найден личный чат: ${chatId}`);
        try {
          const contact = await chat.getContact();
          console.log(`   contact.number: ${contact.number || 'NULL'}`);
          console.log(`   contact.id?.user: ${contact.id?.user || 'NULL'}`);
          console.log(`   contact.name: ${contact.name || 'NULL'}`);
          console.log(`   contact.pushname: ${contact.pushname || 'NULL'}`);
          
          if (contact.number && !isWhatsAppId(contact.number)) {
            const phone = formatPhoneNumber(contact.number);
            console.log(`   ✅ НОМЕР ТЕЛЕФОНА: ${phone}`);
            return { success: true, phone, method: 'personalChats', contact };
          }
        } catch (error) {
          console.log(`   ⚠️ Ошибка получения контакта из чата: ${error.message}`);
        }
      }
    }
    
    console.log(`❌ Личный чат не найден`);
  } catch (error) {
    console.log(`❌ Ошибка: ${error.message}`);
  }
  
  return { success: false, method: 'personalChats' };
}

/**
 * Основная функция тестирования
 */
async function testContactRetrieval() {
  console.log('\n' + '='.repeat(80));
  console.log('ТЕСТИРОВАНИЕ ПОЛУЧЕНИЯ НОМЕРА ТЕЛЕФОНА ИЗ WHATSAPP ID');
  console.log('='.repeat(80));
  
  // 1. Получаем WhatsApp ID из базы данных
  console.log('\nШАГ 1: Получение WhatsApp ID из базы данных...');
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
    console.log('❌ Не найдено предложений с WhatsApp ID в базе данных');
    process.exit(1);
  }
  
  const offer = result.rows[0];
  let whatsappId = null;
  
  if (isWhatsAppId(offer.seller_name)) {
    whatsappId = offer.seller_name;
  } else if (isWhatsAppId(offer.seller_phone)) {
    whatsappId = offer.seller_phone;
  }
  
  if (!whatsappId) {
    console.log('❌ Не удалось определить WhatsApp ID из предложения');
    console.log(`   seller_name: ${offer.seller_name}`);
    console.log(`   seller_phone: ${offer.seller_phone}`);
    process.exit(1);
  }
  
  console.log(`✅ Найден WhatsApp ID: ${whatsappId}`);
  console.log(`   Предложение ID: ${offer.id}`);
  console.log(`   seller_name: ${offer.seller_name}`);
  console.log(`   seller_phone: ${offer.seller_phone}`);
  
  // 2. Получаем WhatsApp клиент
  console.log('\nШАГ 2: Получение WhatsApp клиента...');
  const client = getClient();
  
  if (!client) {
    console.log('❌ WhatsApp клиент не инициализирован');
    process.exit(1);
  }
  
  const status = client.info;
  if (!status || !status.wid) {
    console.log('❌ WhatsApp клиент не готов');
    process.exit(1);
  }
  
  console.log(`✅ WhatsApp клиент готов`);
  console.log(`   Подключен как: ${status.pushname} (${status.wid.user})`);
  
  // 3. Тестируем все методы
  console.log('\nШАГ 3: Тестирование методов получения номера телефона...');
  
  const results = [];
  
  // Метод 1
  const result1 = await method1_getContactById(client, whatsappId);
  results.push(result1);
  
  // Метод 2
  const result2 = await method2_getContacts(client, whatsappId);
  results.push(result2);
  
  // Метод 3
  const result3 = await method3_groupParticipants(client, whatsappId);
  results.push(result3);
  
  // Метод 4
  const result4 = await method4_personalChats(client, whatsappId);
  results.push(result4);
  
  // 4. Итоговый отчет
  console.log('\n' + '='.repeat(80));
  console.log('ИТОГОВЫЙ ОТЧЕТ');
  console.log('='.repeat(80));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\nУспешные методы: ${successful.length}`);
  successful.forEach(r => {
    console.log(`   ✅ ${r.method}: ${r.phone}`);
    if (r.groupName) {
      console.log(`      Найден в группе: ${r.groupName}`);
    }
  });
  
  console.log(`\nНеудачные методы: ${failed.length}`);
  failed.forEach(r => {
    console.log(`   ❌ ${r.method}`);
  });
  
  if (successful.length > 0) {
    const bestResult = successful[0];
    console.log(`\n✅✅✅ РАБОЧИЙ СПОСОБ НАЙДЕН ✅✅✅`);
    console.log(`   Метод: ${bestResult.method}`);
    console.log(`   Номер телефона: ${bestResult.phone}`);
    if (bestResult.groupName) {
      console.log(`   Группа: ${bestResult.groupName}`);
    }
  } else {
    console.log(`\n❌❌❌ НИ ОДИН МЕТОД НЕ СРАБОТАЛ ❌❌❌`);
  }
  
  // Закрываем соединение с БД
  if (springBootPool) {
    await springBootPool.end();
  }
  
  process.exit(0);
}

// Запуск тестирования
testContactRetrieval().catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});



