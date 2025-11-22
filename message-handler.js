import { getClient } from './whatsapp-client.js';
import { sendToAPI } from './api-client.js';
import { logger } from './logger.js';
import { getMonitoringConfig } from './config-manager.js';
import { createOllamaClient } from './ollama-client.js';

// Создаем экземпляр Ollama клиента (можно настроить через переменные окружения)
const ollamaClient = createOllamaClient(
  process.env.OLLAMA_URL || 'http://localhost:11434',
  process.env.OLLAMA_MODEL || null
);

/**
 * Обрабатывает входящее сообщение
 */
export async function handleMessage(message) {
  try {
    logger.info('🔔 ОБРАБОТЧИК СООБЩЕНИЙ ВЫЗВАН - получено новое сообщение');
    
    const client = getClient();
    if (!client) {
      logger.warn('⚠️  WhatsApp клиент не инициализирован');
      return;
    }

    // Получаем информацию о чате
    const chat = await message.getChat();
    const contact = await message.getContact();
    
    logger.info(`📋 Информация о сообщении: Chat ID=${chat.id._serialized}, Contact ID=${contact.id._serialized}`);
    
    // Пропускаем сообщения от самого бота
    if (contact.isMyContact) {
      logger.debug('⏭️  Сообщение от самого себя - пропускаем');
      return;
    }

    // Получаем конфигурацию мониторинга
    const monitoringConfig = getMonitoringConfig();
    
    // Проверяем, нужно ли мониторить этот чат
    const shouldMonitor = shouldMonitorChat(chat, monitoringConfig);
    
    logger.info(`🔍 Проверка мониторинга: Чат="${chat.name || 'Unknown'}", Мониторить=${shouldMonitor}`);
    
    if (!shouldMonitor) {
      logger.info(`⏭️  Чат "${chat.name || 'Unknown'}" не в списке мониторинга - пропускаем`);
      logger.debug(`📋 Группы для мониторинга: ${JSON.stringify(monitoringConfig.groups, null, 2)}`);
      logger.debug(`📋 Мониторить все группы: ${monitoringConfig.monitorAllGroups}`);
      return;
    }
    
    logger.info(`✅ Чат "${chat.name || 'Unknown'}" в списке мониторинга - обрабатываем`);

    // Получаем данные, явно конвертируя в UTF-8
    const chatName = (chat.name || contact.pushname || contact.number || 'Unknown').toString();
    const senderName = (contact.pushname || contact.number || contact.id.user).toString();
    const content = (message.body || '').toString();
    
    logger.info('═'.repeat(80));
    logger.info('📨 НОВОЕ СООБЩЕНИЕ ИЗ WHATSAPP');
    logger.info('═'.repeat(80));
    logger.info(`📱 Чат: ${chatName} (${chat.isGroup ? 'группа' : 'личный чат'})`);
    logger.info(`👤 Отправитель: ${senderName} (${contact.id.user})`);
    logger.info(`💬 Текст сообщения: ${content || '(пусто)'}`);
    logger.info(`⏰ Время: ${new Date(message.timestamp * 1000).toISOString()}`);
    logger.info(`🆔 Message ID: ${message.id._serialized}`);
    
    // Логируем полное входящее сообщение в формате JSON
    const incomingMessageData = {
      messageId: message.id._serialized,
      chatId: chat.id._serialized,
      chatName: chatName,
      chatType: chat.isGroup ? 'group' : 'personal',
      senderId: contact.id._serialized,
      senderName: senderName,
      senderPhoneNumber: contact.id.user,
      content: content,
      timestamp: new Date(message.timestamp * 1000).toISOString(),
      hasMedia: message.hasMedia,
      messageType: message.type,
      isForwarded: message.isForwarded
    };
    
    logger.info('📥 Входящее сообщение из WhatsApp (JSON):', { json: JSON.stringify(incomingMessageData, null, 2) });
    
    // Если есть медиа (фото, документ и т.д.)
    if (message.hasMedia) {
      try {
        const media = await message.downloadMedia();
        if (media) {
          incomingMessageData.mediaMimetype = media.mimetype;
          incomingMessageData.mediaFilename = media.filename;
          incomingMessageData.mediaData = media.data; // base64 (не логируем полностью из-за размера)
          
          logger.info(`📎 Обнаружено медиа: ${media.mimetype} ${media.filename ? `(${media.filename})` : ''}`);
          logger.info(`📎 Медиа размер: ${media.data ? Buffer.from(media.data, 'base64').length : 0} байт`);
        }
      } catch (mediaError) {
        logger.warn(`⚠️  Не удалось загрузить медиа: ${mediaError.message}`);
      }
    }
    
    // Парсим сообщение через Ollama (если доступен)
    let parsedData = null;
    try {
      logger.info('');
      logger.info('═'.repeat(80));
      logger.info('🤖 НАЧАЛО ПАРСИНГА СООБЩЕНИЯ ЧЕРЕЗ OLLAMA');
      logger.info('═'.repeat(80));
      logger.info('');
      
      parsedData = await ollamaClient.parseMessage(content, {
        chatName: chatName,
        senderName: senderName,
        senderPhone: contact.id.user
      });
      
      logger.info('');
      if (parsedData && Object.keys(parsedData).length > 0) {
        logger.info('✅ УСПЕШНО ПОЛУЧЕНЫ РАСПАРСЕННЫЕ ДАННЫЕ ОТ OLLAMA');
        logger.info(`📊 Количество товаров в ответе: ${parsedData.products ? parsedData.products.length : 0}`);
        logger.info(`📊 Тип операции: ${parsedData.operationType || 'не указан'}`);
      } else {
        logger.warn('⚠️  Ollama вернул пустые данные или не удалось распарсить');
      }
      logger.info('');
    } catch (ollamaError) {
      logger.error('═'.repeat(80));
      logger.error('❌ ОШИБКА ПРИ ПАРСИНГЕ ЧЕРЕЗ OLLAMA');
      logger.error('═'.repeat(80));
      logger.error(`Ошибка: ${ollamaError.message}`);
      if (ollamaError.stack) {
        logger.error(`Стек: ${ollamaError.stack}`);
      }
      logger.error('═'.repeat(80));
      logger.error('');
      // Продолжаем работу даже если Ollama недоступен
    }
    
    // Подготавливаем данные для отправки в API интернет-магазина
    const messageData = {
      ...incomingMessageData,
      parsedData: parsedData // Добавляем распарсенные данные
    };
    
    // Удаляем mediaData из JSON для логирования (слишком большой)
    const messageDataForLog = { ...messageData };
    if (messageDataForLog.mediaData) {
      messageDataForLog.mediaData = `[Base64 данные, размер: ${Buffer.from(messageData.mediaData, 'base64').length} байт]`;
    }
    
    logger.info('─'.repeat(80));
    logger.info('🌐 ОТПРАВКА В ИНТЕРНЕТ-МАГАЗИН (SPRING BOOT API)');
    logger.info('─'.repeat(80));
    logger.info('📤 Отправляемые данные в интернет-магазин (JSON):', { 
      json: JSON.stringify(messageDataForLog, null, 2),
      messageData: messageDataForLog
    });
    
    // Отправляем в API
    const apiConfig = monitoringConfig.api;
    const result = await sendToAPI(
      messageData, 
      apiConfig.url, 
      apiConfig.endpoint, 
      apiConfig.apiKey || null,
      0 // retryCount
    );
    
    if (result.success) {
      logger.info('✅ Сообщение успешно отправлено в интернет-магазин');
      logger.info(`📥 Ответ от интернет-магазина (JSON):`, { 
        json: JSON.stringify(result.response, null, 2),
        response: result.response
      });
    } else {
      logger.error(`❌ Ошибка отправки в интернет-магазин: ${result.error}`, { error: result.error });
    }
    
    logger.info('═'.repeat(80));
    logger.info('✅ ОБРАБОТКА СООБЩЕНИЯ ЗАВЕРШЕНА');
    logger.info('═'.repeat(80));
    logger.info('');
    
  } catch (error) {
    logger.error('═'.repeat(80));
    logger.error('❌ КРИТИЧЕСКАЯ ОШИБКА ПРИ ОБРАБОТКЕ СООБЩЕНИЯ');
    logger.error('═'.repeat(80));
    logger.error('Ошибка:', error.message);
    logger.error('Стек:', error.stack);
    logger.error('═'.repeat(80));
    logger.error('');
  }
}

/**
 * Проверяет, нужно ли мониторить чат
 */
function shouldMonitorChat(chat, monitoringConfig) {
  const { groups, personalChats, monitorAllGroups, monitorAllPersonal } = monitoringConfig;
  
  if (chat.isGroup) {
    // Группа
    if (monitorAllGroups) {
      return true;
    }
    
    if (groups.length === 0) {
      return false;
    }
    
    return groups.some(chatIdOrName => {
      const searchId = chatIdOrName.toLowerCase();
      const chatId = chat.id._serialized.toLowerCase();
      const chatName = (chat.name || '').toLowerCase();
      
      return chatId.includes(searchId) || chatName.includes(searchId);
    });
  } else {
    // Личный чат
    if (monitorAllPersonal) {
      return true;
    }
    
    if (personalChats.length === 0) {
      return false;
    }
    
    return personalChats.some(chatIdOrName => {
      const searchId = chatIdOrName.toLowerCase();
      const chatId = chat.id._serialized.toLowerCase();
      const contactName = (chat.name || '').toLowerCase();
      
      return chatId.includes(searchId) || contactName.includes(searchId);
    });
  }
}

/**
 * Обрабатывает тестовое сообщение (симуляция сообщения из WhatsApp)
 * @param {string} content - Текст сообщения
 * @param {string} chatName - Название чата (например, "Test Group")
 * @param {string} senderName - Имя отправителя (например, "Test User")
 * @param {string} senderPhone - Телефон отправителя (например, "79999999999")
 * @param {boolean} isGroup - Является ли чат группой (по умолчанию true)
 */
export async function handleTestMessage(content, chatName = 'Test Group', senderName = 'Test User', senderPhone = '79999999999', isGroup = true) {
  try {
    logger.info('═'.repeat(80));
    logger.info('🧪 ТЕСТОВОЕ СООБЩЕНИЕ (СИМУЛЯЦИЯ)');
    logger.info('═'.repeat(80));
    logger.info(`📱 Чат: ${chatName} (${isGroup ? 'группа' : 'личный чат'})`);
    logger.info(`👤 Отправитель: ${senderName} (${senderPhone})`);
    logger.info(`💬 Текст сообщения: ${content || '(пусто)'}`);
    logger.info(`⏰ Время: ${new Date().toISOString()}`);
    logger.info('');

    // Создаем объект-заглушку сообщения, который будет обработан как обычное сообщение
    const testMessageId = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const testChatId = `test_chat_${chatName.replace(/\s+/g, '_').toLowerCase()}`;
    
    // Подготавливаем данные сообщения в формате, аналогичном реальному сообщению
    const messageData = {
      messageId: testMessageId,
      chatId: testChatId,
      chatName: chatName,
      chatType: isGroup ? 'group' : 'personal',
      senderId: `test_sender_${senderPhone}`,
      senderName: senderName,
      senderPhoneNumber: senderPhone,
      content: content,
      timestamp: new Date().toISOString(),
      hasMedia: false,
      messageType: 'chat',
      isForwarded: false
    };
    
    logger.info('📥 Тестовое сообщение (JSON):', { json: JSON.stringify(messageData, null, 2) });
    logger.info('');

    // Парсим сообщение через Ollama (если доступен)
    let parsedData = null;
    try {
      logger.info('');
      logger.info('═'.repeat(80));
      logger.info('🤖 НАЧАЛО ПАРСИНГА ТЕСТОВОГО СООБЩЕНИЯ ЧЕРЕЗ OLLAMA');
      logger.info('═'.repeat(80));
      logger.info('');
      
      parsedData = await ollamaClient.parseMessage(content, {
        chatName: chatName,
        senderName: senderName,
        senderPhone: senderPhone
      });
      
      logger.info('');
      if (parsedData && Object.keys(parsedData).length > 0) {
        logger.info('✅ УСПЕШНО ПОЛУЧЕНЫ РАСПАРСЕННЫЕ ДАННЫЕ ОТ OLLAMA');
        logger.info(`📊 Количество товаров в ответе: ${parsedData.products ? parsedData.products.length : 0}`);
        logger.info(`📊 Тип операции: ${parsedData.operationType || 'не указан'}`);
      } else {
        logger.warn('⚠️  Ollama вернул пустые данные или не удалось распарсить');
      }
      logger.info('');
    } catch (ollamaError) {
      logger.error('═'.repeat(80));
      logger.error('❌ ОШИБКА ПРИ ПАРСИНГЕ ТЕСТОВОГО СООБЩЕНИЯ ЧЕРЕЗ OLLAMA');
      logger.error('═'.repeat(80));
      logger.error(`Ошибка: ${ollamaError.message}`);
      if (ollamaError.stack) {
        logger.error(`Стек: ${ollamaError.stack}`);
      }
      logger.error('═'.repeat(80));
      logger.error('');
      // Продолжаем работу даже если Ollama недоступен
    }

    // Добавляем распарсенные данные
    messageData.parsedData = parsedData;

    // Удаляем mediaData из JSON для логирования
    const messageDataForLog = { ...messageData };
    if (messageDataForLog.mediaData) {
      const mediaSize = Buffer.from(messageData.mediaData, 'base64').length;
      messageDataForLog.mediaData = `[Base64 данные, размер: ${mediaSize} байт]`;
    }
    
    logger.info('📤 Подготовленные данные для отправки в Spring Boot API:', { 
      json: JSON.stringify(messageDataForLog, null, 2),
      messageData: messageDataForLog
    });
    logger.info('');

    // Получаем конфигурацию мониторинга для определения API URL
    const monitoringConfig = getMonitoringConfig();
    const apiConfig = monitoringConfig.api || {};
    
    // Отправляем в Spring Boot API
    try {
      await sendToAPI(
        messageData,
        apiConfig.url || null,
        apiConfig.endpoint || null,
        apiConfig.apiKey || null,
        0 // retryCount
      );
      
      logger.info('✅ Тестовое сообщение успешно обработано и отправлено в Spring Boot API');
      logger.info('═'.repeat(80));
      logger.info('');
      
      return {
        success: true,
        messageData: messageDataForLog,
        parsedData: parsedData
      };
    } catch (apiError) {
      logger.error('❌ Ошибка отправки тестового сообщения в Spring Boot API:', apiError.message);
      logger.error('═'.repeat(80));
      logger.error('');
      
      throw apiError;
    }
    
  } catch (error) {
    logger.error('❌ Ошибка обработки тестового сообщения:', error.message);
    if (error.stack) {
      logger.error(`Стек: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Инициализирует обработчик сообщений
 */
export function initializeMessageHandler() {
  const client = getClient();
  if (!client) {
    logger.warn('WhatsApp клиент не инициализирован для обработки сообщений');
    return;
  }

  // Обработчик сообщений
  client.on('message', handleMessage);
  
  logger.info('✅ Обработчик сообщений инициализирован');
}
