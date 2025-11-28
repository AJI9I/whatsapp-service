import { getClient } from './whatsapp-client.js';
import { sendToAPI, sendToMultipleAPIs } from './api-client.js';
import { logger } from './logger.js';
import { getMonitoringConfig } from './config-manager.js';
import { logIncomingMessage } from './messages-logger.js'; // Импортируем логгер сообщений
import { addProduct } from './products-buffer.js'; // Импортируем буфер оборудования
import { messageRepository } from './message-repository.js'; // Импортируем репозиторий сообщений
import { ollamaServiceClient } from './ollama-service-client.js'; // Импортируем клиент Ollama Service
import { getActiveTasksForChat } from './tasks-manager.js'; // Импортируем менеджер заданий
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Путь к файлу для логирования входящих сообщений
const INCOMING_MESSAGES_LOG_FILE = path.join(__dirname, 'smgIN.txt');

/**
 * Обрабатывает входящее сообщение
 */
export async function handleMessage(message) {
  // ВАЖНО: Логирование сырого сообщения в файл должно быть ПЕРВЫМ действием,
  // до всех проверок и возможных return, чтобы гарантированно записать все сообщения
  try {
    const timestamp = new Date().toISOString();
    const separator = '\n' + '='.repeat(80) + '\n';
    
    // Формируем текстовую запись сырого ответа от WhatsApp
    let rawMessageText = separator;
    rawMessageText += `ВРЕМЯ ПОЛУЧЕНИЯ: ${timestamp}\n`;
    rawMessageText += separator;
    rawMessageText += 'СЫРОЙ ОБЪЕКТ СООБЩЕНИЯ ОТ WHATSAPP:\n';
    rawMessageText += separator;
    
    // Записываем весь объект message целиком в JSON формате
    try {
      // Создаем WeakSet для отслеживания циклических ссылок
      const seen = new WeakSet();
      
      // Сериализуем весь объект message со всеми его полями
      rawMessageText += JSON.stringify(message, (key, value) => {
        // Обрабатываем функции
        if (typeof value === 'function') {
          return '[Function]';
        }
        // Обрабатываем undefined
        if (typeof value === 'undefined') {
          return '[Undefined]';
        }
        // Обрабатываем циклические ссылки
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        return value;
      }, 2);
    } catch (jsonError) {
      // Если не удалось сериализовать через JSON.stringify, пробуем альтернативный способ
      rawMessageText += `Ошибка сериализации JSON: ${jsonError.message}\n`;
      rawMessageText += `Попытка альтернативной сериализации...\n\n`;
      
      // Пробуем записать все доступные свойства объекта
      try {
        const messageProps = {};
        const processed = new WeakSet();
        
        function extractProps(obj, depth = 0) {
          if (depth > 5) return '[Max Depth]'; // Ограничиваем глубину
          if (obj === null) return null;
          if (typeof obj !== 'object') return obj;
          if (processed.has(obj)) return '[Circular Reference]';
          processed.add(obj);
          
          const result = {};
          for (const key in obj) {
            try {
              const value = obj[key];
              if (typeof value === 'function') {
                result[key] = '[Function]';
              } else if (typeof value === 'undefined') {
                result[key] = '[Undefined]';
              } else if (typeof value === 'object' && value !== null) {
                result[key] = extractProps(value, depth + 1);
              } else {
                result[key] = value;
              }
            } catch (propError) {
              result[key] = `[Error: ${propError.message}]`;
            }
          }
          return result;
        }
        
        const extracted = extractProps(message);
        rawMessageText += JSON.stringify(extracted, null, 2);
      } catch (altError) {
        rawMessageText += `Альтернативная сериализация также не удалась: ${altError.message}\n`;
        rawMessageText += `Доступные ключи объекта: ${Object.keys(message).join(', ')}\n`;
      }
    }
    
    rawMessageText += '\n';
    
    // Проверяем и создаем директорию, если её нет
    const logDir = path.dirname(INCOMING_MESSAGES_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      logger.info(`📁 Создана директория для логов: ${logDir}`);
    }
    
    // Добавляем в файл (создаем если не существует)
    fs.appendFileSync(INCOMING_MESSAGES_LOG_FILE, rawMessageText, 'utf8');
    logger.info(`✅ Сырой объект сообщения записан в ${INCOMING_MESSAGES_LOG_FILE}`);
  } catch (logError) {
    logger.error(`❌ Ошибка записи в файл smgIN.txt: ${logError.message}`);
    logger.error(`   Путь к файлу: ${INCOMING_MESSAGES_LOG_FILE}`);
    logger.error(`   Абсолютный путь: ${path.resolve(INCOMING_MESSAGES_LOG_FILE)}`);
    if (logError.stack) {
      logger.error(`   Стек ошибки: ${logError.stack}`);
    }
    // НЕ прерываем выполнение - продолжаем обработку сообщения даже если логирование не удалось
  }
  
  try {
    logger.info('═'.repeat(80));
    logger.info('🔔 ЭТАП 1: ПОЛУЧЕНО НОВОЕ СООБЩЕНИЕ');
    logger.info('═'.repeat(80));
    
    // Получаем конфигурацию для проверки настроек логирования
    const monitoringConfig = getMonitoringConfig();
    const loggingConfig = monitoringConfig.logging || {};
    const logReceivedMessages = loggingConfig.logReceivedMessages !== false; // По умолчанию true
    
    if (logReceivedMessages) {
      logger.info('🔔 ОБРАБОТЧИК СООБЩЕНИЙ ВЫЗВАН - получено новое сообщение');
      logger.info(`📨 ID сообщения: ${message.id?._serialized || message.id || 'unknown'}`);
      logger.info(`📨 Тип сообщения: ${message.type || 'unknown'}`);
      logger.info(`📨 Есть тело сообщения: ${!!message.body}`);
      if (message.body) {
        const bodyPreview = message.body.substring(0, 100);
        logger.info(`📨 Превью сообщения: ${bodyPreview}${message.body.length > 100 ? '...' : ''}`);
      }
    }
    
    const client = getClient();
    if (!client) {
      logger.warn('⚠️  WhatsApp клиент не инициализирован');
      return;
    }

    // Получаем информацию о чате
    let chat, contact;
    try {
      chat = await message.getChat();
    } catch (chatError) {
      logger.error('❌ Ошибка получения информации о чате:', chatError.message);
      return; // Прекращаем обработку, если не можем получить чат
    }
    
    const chatName = chat.name || 'Unknown';
    const chatId = chat.id?._serialized || 'unknown';
    const isGroup = chat.isGroup || false;
    
    // Получаем контакт с правильной обработкой для групповых и личных сообщений
    // ВАЖНО: Для групповых сообщений используем message.author и client.getContactById()
    try {
      if (isGroup) {
        // Для групповых сообщений используем message.author для получения ID автора
        const authorId = message.author || message.from || (message.id && message.id.participant) || null;
        
        if (authorId) {
          logger.info(`📋 Групповое сообщение, автор ID: ${authorId}`);
          
          // Пытаемся получить контакт по ID через client.getContactById()
          try {
            contact = await client.getContactById(authorId);
            logger.info(`✅ Контакт получен через getContactById() для группы: ${contact.pushname || contact.name || contact.number || 'unknown'}`);
          } catch (getContactByIdError) {
            logger.warn(`⚠️  Не удалось получить контакт через getContactById(${authorId}), пробуем getContact(): ${getContactByIdError.message}`);
            // Fallback: пробуем обычный getContact()
            contact = await message.getContact();
            logger.info(`✅ Контакт получен через getContact() для группы`);
          }
        } else {
          // Если нет author, пробуем обычный getContact()
          contact = await message.getContact();
          logger.info(`✅ Контакт получен через getContact() для группы (без author)`);
        }
      } else {
        // Для личных сообщений используем обычный getContact()
        contact = await message.getContact();
        logger.debug('✅ Контакт получен успешно через getContact() для личного чата');
      }
    } catch (contactError) {
      // Если не удалось получить контакт, используем данные из сообщения
      const errorMessage = contactError?.message || String(contactError) || '';
      
      // Для известной ошибки getIsMyContact логируем только на уровне info (не error!)
      if (errorMessage.includes('getIsMyContact')) {
        logger.info('⚠️  Известная проблема с getIsMyContact, используем fallback контакт (это нормально, не ошибка)');
      } else {
        // Для других ошибок логируем как предупреждение
        logger.warn(`⚠️  Не удалось получить контакт, используем fallback: ${errorMessage.substring(0, 150)}`);
      }
      
      // Создаем fallback контакт из данных сообщения
      // Для групповых сообщений приоритет: message.author > message.from
      const fromId = isGroup 
        ? (message.author || message.from || (message.id && message.id.participant) || (message.id && message.id.remote) || 'unknown@c.us')
        : (message.from || message.author || (message.id && message.id.remote) || 'unknown@c.us');
      const userId = fromId.split('@')[0];
      
      contact = {
        id: { 
          user: userId, 
          _serialized: fromId,
          server: fromId.includes('@g.us') ? 'g.us' : 'c.us'
        },
        pushname: message.notifyName || message.pushName || message.fromName || userId,
        number: userId,
        name: message.notifyName || message.pushName || message.fromName || userId,
        isMyContact: false, // Устанавливаем явно, чтобы избежать дальнейших ошибок
        isUser: true,
        isGroup: fromId.includes('@g.us'),
        isWAContact: false
      };
      
      logger.info(`📋 Используем fallback контакт: ${contact.pushname} (${userId})`);
      // ВАЖНО: НЕ пробрасываем ошибку дальше - продолжаем обработку с fallback контактом
    }
    
    // Безопасное логирование информации о сообщении
    try {
      logger.info(`📋 Информация о сообщении: Chat ID=${chat.id?._serialized || 'unknown'}, Contact ID=${contact.id?._serialized || 'unknown'}`);
    } catch (logError) {
      logger.debug('Не удалось залогировать информацию о сообщении');
    }
    
    // Проверка "от самого себя" - опциональна (можно отключить в настройках)
    const skipOwnMessages = loggingConfig.skipOwnMessages === true; // По умолчанию false - обрабатываем все
    if (skipOwnMessages) {
      try {
        let isMyContact = false;
        
        // Проверяем по ID клиента (самый надежный способ)
        if (client.info && client.info.wid) {
          try {
            const clientId = client.info.wid.user || client.info.wid._serialized;
            const contactId = contact.id?.user || contact.id?._serialized;
            
            if (clientId && contactId && clientId === contactId) {
              isMyContact = true;
              if (logReceivedMessages) {
                logger.info(`⏭️  Сообщение от самого себя - пропускаем (Chat: ${chatName}, ID: ${chatId})`);
              }
              return;
            }
          } catch (idCheckError) {
            logger.debug(`⚠️  Ошибка проверки по ID: ${idCheckError?.message || idCheckError}`);
          }
        }
        
        // Дополнительная проверка: сравниваем message.from с ID клиента
        if (!isMyContact && message.from && client.info && client.info.wid) {
          try {
            const clientId = client.info.wid.user;
            const messageFrom = message.from.split('@')[0];
            
            if (clientId && messageFrom && clientId === messageFrom) {
              isMyContact = true;
              if (logReceivedMessages) {
                logger.info(`⏭️  Сообщение от самого себя - пропускаем (Chat: ${chatName}, ID: ${chatId})`);
              }
              return;
            }
          } catch (fromCheckError) {
            logger.debug(`⚠️  Ошибка проверки по message.from: ${fromCheckError?.message || fromCheckError}`);
          }
        }
      } catch (contactCheckError) {
        logger.warn(`⚠️  Ошибка при проверке "от самого себя", продолжаем обработку: ${contactCheckError?.message || contactCheckError}`);
      }
    }

    // Проверяем задания для этого чата
    let activeTasks = [];
    let taskPromptId = null;
    
    try {
      activeTasks = await getActiveTasksForChat(chatId);
      if (activeTasks.length > 0) {
        // Используем первое активное задание (можно расширить для нескольких заданий)
        const task = activeTasks[0];
        taskPromptId = task.promptId;
        logger.info(`✅ Найдено задание "${task.name}" для чата "${chatName}" (промпт ID: ${taskPromptId})`);
      }
    } catch (taskError) {
      logger.warn(`⚠️  Ошибка получения заданий: ${taskError.message}`);
    }
    
    // Если нет активных заданий, проверяем старую систему мониторинга
    let shouldMonitor = false;
    
    if (activeTasks.length > 0) {
      shouldMonitor = true;
    } else {
      // Старая система мониторинга
      shouldMonitor = shouldMonitorChat(chat, monitoringConfig);
    }
    
    if (!shouldMonitor) {
      // Улучшенное логирование пропущенных чатов: просто Name и ID
      logger.info(`⏭️  Чат пропущен - Name: "${chatName}", ID: ${chatId}`);
      return;
    }
    
    if (logReceivedMessages) {
      logger.info(`🔍 Проверка мониторинга:`);
      logger.info(`   Чат: "${chatName}"`);
      logger.info(`   Chat ID: ${chatId}`);
      logger.info(`   Тип: ${chat.isGroup ? 'группа' : 'личный чат'}`);
      logger.info(`   Мониторить: ДА ✅`);
      if (taskPromptId) {
        logger.info(`   Промпт из задания: ${taskPromptId}`);
      }
    }
    
    logger.info(`✅ Чат "${chatName}" в списке мониторинга - обрабатываем`);

    // Получаем данные, явно конвертируя в UTF-8
    const content = (message?.body || '').toString();
    
    // Улучшенное получение информации об отправителе для групповых и личных сообщений
    // Используем функцию formatPhoneNumber из restore-contacts-service
    const { formatPhoneNumber } = await import('./restore-contacts-service.js');
    
    let senderName = null;
    let senderPhoneNumber = null;
    
    // Для групповых сообщений приоритет: pushname > name > notifyName > number
    // Для личных сообщений приоритет: pushname > name > number
    if (isGroup) {
      // Для групповых сообщений используем pushname или name из контакта
      senderName = contact?.pushname || contact?.name || message?.notifyName || message?.pushName || message?.fromName || null;
      
      // Если имя не найдено, пробуем получить из участников группы
      if (!senderName || senderName === 'Unknown' || senderName.length > 100) {
        try {
          const participants = await chat.participants;
          if (participants && Array.isArray(participants)) {
            const authorId = message.author || message.from || contact?.id?._serialized;
            const participant = participants.find(p => {
              const pId = p.id?._serialized || p.id?.user || p.id;
              return pId === authorId || pId?.includes(authorId?.split('@')[0]);
            });
            if (participant) {
              senderName = participant.pushname || participant.name || participant.number || null;
              logger.info(`📋 Имя получено из участников группы: ${senderName}`);
            }
          }
        } catch (participantsError) {
          logger.debug(`⚠️  Не удалось получить участников группы: ${participantsError.message}`);
        }
      }
    } else {
      // Для личных сообщений используем pushname или name
      senderName = contact?.pushname || contact?.name || null;
    }
    
    // Извлекаем номер телефона с приоритетом
    // Приоритет: contact.number > contact.id.user > contact.id._serialized > message.author > message.from
    if (contact?.number && typeof contact.number === 'string' && contact.number.length <= 15 && !contact.number.includes('@')) {
      senderPhoneNumber = formatPhoneNumber(contact.number);
      logger.debug(`📞 Номер получен из contact.number: ${senderPhoneNumber}`);
    } else if (contact?.id?.user && typeof contact.id.user === 'string' && contact.id.user.length <= 15 && !contact.id.user.includes('@')) {
      senderPhoneNumber = formatPhoneNumber(contact.id.user);
      logger.debug(`📞 Номер получен из contact.id.user: ${senderPhoneNumber}`);
    } else if (contact?.id?._serialized) {
      const phoneFromSerialized = contact.id._serialized.split('@')[0];
      if (phoneFromSerialized && phoneFromSerialized.length <= 15 && phoneFromSerialized !== 'unknown') {
        senderPhoneNumber = formatPhoneNumber(phoneFromSerialized);
        logger.debug(`📞 Номер получен из contact.id._serialized: ${senderPhoneNumber}`);
      }
    }
    
    // Если не удалось получить номер из контакта, используем fallback из сообщения
    if (!senderPhoneNumber) {
      // Для групповых сообщений приоритет: message.author > message.from
      const fromId = isGroup 
        ? (message.author || message.from || (message.id && message.id.participant) || '')
        : (message.from || message.author || '');
      const userId = fromId.split('@')[0];
      if (userId && userId.length <= 15 && userId !== 'unknown' && !userId.includes('@')) {
        senderPhoneNumber = formatPhoneNumber(userId);
        logger.debug(`📞 Номер получен из message (fallback): ${senderPhoneNumber}`);
      }
    }
    
    // Если имя не найдено или некорректное, используем номер телефона или ID
    if (!senderName || senderName === 'Unknown' || senderName.length > 100 || senderName === contact?.id?.user) {
      if (senderPhoneNumber && senderPhoneNumber !== 'unknown') {
        senderName = senderPhoneNumber;
      } else if (contact?.id?.user) {
        senderName = contact.id.user;
      } else {
        senderName = 'Unknown';
      }
    }
    
    // Дополнительный метод получения номера телефона через чат автора
    // Используем тот же метод, что работает в API тестах
    // Этот метод более надежный, поэтому используем его для обновления номера
    try {
      // Определяем chatId автора сообщения
      // Если есть message.id.participant (групповое сообщение), используем message.author
      // Иначе используем message.from (личное сообщение)
      let authorChatId;
      if (message.id?.participant) {
        authorChatId = message.author || message.from;
      } else {
        authorChatId = message.from;
      }
      
      if (authorChatId) {
        // Получаем чат по ID автора
        const authorChat = await client.getChatById(authorChatId);
        
        // Извлекаем номер телефона из chat.id.user
        const authorPhone = authorChat?.id?.user || null;
        
        if (authorPhone && authorPhone.length <= 15 && !authorPhone.includes('@')) {
          const newPhoneNumber = formatPhoneNumber(authorPhone);
          if (newPhoneNumber && newPhoneNumber !== 'unknown') {
            // Обновляем номер телефона, если получен новый
            if (senderPhoneNumber !== newPhoneNumber) {
              logger.info(`📞 Номер обновлен через метод чата автора: ${senderPhoneNumber} → ${newPhoneNumber}`);
            } else {
              logger.debug(`📞 Номер подтвержден через метод чата автора: ${newPhoneNumber}`);
            }
            senderPhoneNumber = newPhoneNumber;
          }
        }
      }
    } catch (authorChatError) {
      logger.debug(`⚠️  Не удалось получить/обновить номер через чат автора: ${authorChatError.message}`);
      // Не критично, продолжаем с текущим значением
    }
    
    // Если номер все еще не найден, используем 'unknown'
    if (!senderPhoneNumber) {
      senderPhoneNumber = 'unknown';
    }
    
    logger.info(`📞 Информация об отправителе: Имя="${senderName}", Телефон="${senderPhoneNumber}", Группа=${isGroup}`);
    
    // Детальное логирование сообщения (если включено в настройках)
    if (logReceivedMessages) {
      logger.info('═'.repeat(80));
      logger.info('📨 НОВОЕ СООБЩЕНИЕ ИЗ WHATSAPP');
      logger.info('═'.repeat(80));
      logger.info(`📱 Чат: ${chatName} (${chat.isGroup ? 'группа' : 'личный чат'})`);
      logger.info(`👤 Отправитель: ${senderName} (${contact?.id?.user || 'unknown'})`);
      logger.info(`💬 Текст сообщения: ${content || '(пусто)'}`);
      logger.info(`⏰ Время: ${new Date(message.timestamp * 1000).toISOString()}`);
      logger.info(`🆔 Message ID: ${message.id._serialized}`);
    }
    
    // Логируем полное входящее сообщение в формате JSON
    const incomingMessageData = {
      messageId: message.id._serialized,
      chatId: chat.id._serialized,
      chatName: chatName,
      chatType: chat.isGroup ? 'group' : 'personal',
      senderId: contact?.id?._serialized || contact?.id?.user || 'unknown',
      senderName: senderName,
      senderPhoneNumber: senderPhoneNumber || 'unknown',
      content: content,
      timestamp: new Date(message.timestamp * 1000).toISOString(),
      hasMedia: message.hasMedia,
      messageType: message.type,
      isForwarded: message.isForwarded
    };
    
    logger.info('📥 Входящее сообщение из WhatsApp (JSON):', { json: JSON.stringify(incomingMessageData, null, 2) });
    
    logger.info('═'.repeat(80));
    logger.info('💾 ЭТАП 3: СОХРАНЕНИЕ СООБЩЕНИЯ В БД');
    logger.info('═'.repeat(80));
    
    // Сохраняем сообщение в БД
    let savedMessage = null;
    try {
      const messageDataToSave = {
        whatsappMessageId: message.id._serialized,
        chatId: chat.id._serialized,
        chatName: chatName,
        chatType: chat.isGroup ? 'group' : 'personal',
        senderId: contact?.id?._serialized || contact?.id?.user || 'unknown',
        senderName: senderName,
        senderPhoneNumber: senderPhoneNumber || 'unknown',
        content: content,
        hasMedia: message.hasMedia || false,
        messageType: message.type,
        isForwarded: message.isForwarded || false,
        timestamp: new Date(message.timestamp * 1000),
        promptId: taskPromptId || null // Сохраняем prompt_id из задания
      };
      
      logger.info('💾 Подготовка данных для сохранения в БД:');
      logger.info(`   senderPhoneNumber: "${messageDataToSave.senderPhoneNumber}"`);
      logger.info(`   senderName: "${messageDataToSave.senderName}"`);
      logger.info(`   senderId: "${messageDataToSave.senderId}"`);
      logger.info(`   chatId: "${messageDataToSave.chatId}"`);
      logger.info(`   chatName: "${messageDataToSave.chatName}"`);
      logger.info(`   promptId: ${messageDataToSave.promptId || 'null (не задан)'}`);
      logger.info(`   content length: ${messageDataToSave.content?.length || 0} символов`);
      
      logger.info('💾 Вызов messageRepository.saveMessage()...');
      savedMessage = await messageRepository.saveMessage(messageDataToSave);
      
      logger.info(`✅ Сообщение сохранено в БД (ID: ${savedMessage.id})`);
      
      // Проверяем, что сохранилось в БД (читаем обратно)
      logger.info('🔍 Проверка сохраненного сообщения из БД...');
      const savedMessageFromDb = await messageRepository.getMessageById(savedMessage.id);
      if (savedMessageFromDb) {
        logger.info(`✅ Сообщение найдено в БД:`);
        logger.info(`   sender_phone_number: "${savedMessageFromDb.sender_phone_number || 'NULL'}"`);
        logger.info(`   sender_name: "${savedMessageFromDb.sender_name || 'NULL'}"`);
        logger.info(`   sender_id: "${savedMessageFromDb.sender_id || 'NULL'}"`);
      }
    } catch (dbError) {
      logger.error(`❌ Ошибка сохранения сообщения в БД: ${dbError.message}`);
      if (dbError.stack) {
        logger.error(`   Стек ошибки: ${dbError.stack}`);
      }
      // Продолжаем обработку даже при ошибке БД
    }
    
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
    
    logger.info('═'.repeat(80));
    logger.info('🤖 ЭТАП 4: ОТПРАВКА СООБЩЕНИЯ В OLLAMA SERVICE');
    logger.info('═'.repeat(80));
    
    // Отправляем сообщение в Ollama Service для парсинга (асинхронно через callback)
    const logOllamaResponse = loggingConfig.logOllamaResponse !== false; // По умолчанию true
    let ollamaTaskId = null;
    
    if (savedMessage) {
      try {
        if (logOllamaResponse) {
          logger.info('🤖 Подготовка к отправке в Ollama Service...');
          logger.info(`   Message ID: ${savedMessage.id}`);
          logger.info(`   Prompt ID: ${taskPromptId || 'default'}`);
          logger.info(`   Content length: ${content?.length || 0} символов`);
        }
        
        // Отправляем в Ollama Service через HTTP API
        // Используем промпт из задания, если есть
        const promptIdToUse = taskPromptId || null;
        
        const result = await ollamaServiceClient.parseMessage(
          content,
          savedMessage.id, // ID из БД WhatsApp Service
          promptIdToUse, // prompt_id из задания или дефолтный
          null, // callback_url (используется дефолтный)
          logOllamaResponse
        );
        
        if (result && result.success && result.task_id) {
          ollamaTaskId = result.task_id;
          
          // Обновляем статус сообщения в БД
          await messageRepository.updateStatus(
            savedMessage.id,
            'sent_to_ollama',
            ollamaTaskId,
            taskPromptId || null // Сохраняем prompt_id из задания
          );
          
          logger.info(`✅ Сообщение #${savedMessage.id} отправлено в Ollama Service (Task ID: ${ollamaTaskId})`);
          logger.info(`   Ожидаем callback с результатом парсинга...`);
        }
      } catch (ollamaError) {
        logger.error('═'.repeat(80));
        logger.error('❌ ОШИБКА ПРИ ОТПРАВКЕ В OLLAMA SERVICE');
        logger.error('═'.repeat(80));
        logger.error(`Ошибка: ${ollamaError?.message || ollamaError?.toString() || 'Неизвестная ошибка'}`);
        
        // Обновляем статус на failed
        if (savedMessage) {
          try {
            await messageRepository.updateStatus(savedMessage.id, 'failed');
          } catch (e) {
            logger.error(`Ошибка обновления статуса: ${e.message}`);
          }
        }
      }
    }
    
    // ВАЖНО: Не ждем результата парсинга здесь - он придет через callback
    // Продолжаем обработку только если сообщение уже было обработано ранее
    // или если это синхронный режим (для обратной совместимости)
    
    // Для обратной совместимости: если нет savedMessage, используем старый подход
    let parsedData = null;
    if (!savedMessage) {
      logger.warn('⚠️  Сообщение не сохранено в БД, используем старый подход (не рекомендуется)');
      // TODO: Можно добавить fallback на старый ollamaQueueClient, если нужно
    }
    
    // Логируем результат (если включено)
    if (logOllamaResponse) {
      logger.info(`📥 parseMessage() завершен, результат: ${parsedData ? 'данные получены' : 'null'}`);
      logger.info('');
      
      if (parsedData && Object.keys(parsedData).length > 0) {
        logger.info('✅ УСПЕШНО ПОЛУЧЕНЫ РАСПАРСЕННЫЕ ДАННЫЕ ОТ OLLAMA');
        logger.info(`📊 Количество товаров в ответе: ${parsedData.products ? parsedData.products.length : 0}`);
        logger.info(`📊 Тип операции: ${parsedData.operationType || 'не указан'}`);
        logger.info(`📊 Это оборудование для майнинга: ${parsedData.isMiningEquipment !== false ? 'ДА' : 'НЕТ'}`);
      } else {
        logger.warn('⚠️  Ollama вернул пустые данные или не удалось распарсить');
        logger.warn('   Это сообщение будет залогировано для отладки, но не отправлено в бэкенд');
      }
      logger.info('');
    } else {
      // Минимальное логирование даже при отключенном детальном логировании
      if (!parsedData) {
        logger.warn('⚠️  Ollama вернул пустые данные для сообщения');
      }
    }
    
    // Подготавливаем данные для отправки в API интернет-магазина
    const messageData = {
      ...incomingMessageData,
      source: 'whatsapp',
      parsedData: parsedData // Добавляем распарсенные данные
    };
    
    // Логируем входящее сообщение для обработки (ВСЕГДА, независимо от результата парсинга)
    logIncomingMessage(messageData);
    
    // УПРОЩЕННАЯ ПРОВЕРКА: относится ли сообщение к оборудованию для майнинга
    // 1. Если Ollama не вернул данные или явно указал isMiningEquipment: false - пропускаем
    if (!parsedData || parsedData.isMiningEquipment === false) {
      if (!parsedData) {
        logger.warn('⚠️  Ollama не вернул данные - сообщение не будет отправлено в бэкенд');
      } else {
        logger.info('⏭️  СООБЩЕНИЕ НЕ О ПРОДАЖЕ ОБОРУДОВАНИЯ ДЛЯ МАЙНИНГА - ПРОПУСКАЕМ');
      }
      return; // Прекращаем обработку, не отправляем в API
    }
    
    // 2. Проверяем, что есть хотя бы один товар
    if (!parsedData.products || !Array.isArray(parsedData.products) || parsedData.products.length === 0) {
      logger.warn('⚠️  Ollama определил как майнинг, но не извлек товары - сообщение не будет отправлено в бэкенд');
      return;
    }
    
    // Сохраняем оборудование в буфер для отображения в веб-интерфейсе
    try {
      logger.info('💾 Начало сохранения оборудования в буфер...');
      logger.info(`📊 Количество товаров для сохранения: ${parsedData.products.length}`);
      
      let savedCount = 0;
      let skippedCount = 0;
      
      for (const product of parsedData.products) {
        // Проверяем наличие модели (обязательное поле)
        if (!product || !product.model || !product.model.trim()) {
          skippedCount++;
          logger.debug(`⏭️  Пропущен товар без модели: ${JSON.stringify(product)}`);
          continue;
        }
        
        // Формируем данные для сохранения
        const productData = {
          model: product.model.trim(),
          manufacturer: product.manufacturer || 'Не указан',
          hashrate: product.hashrate || 'Не указан',
          price: product.price || null,
          currency: product.currency || '',
          location: parsedData.location || '',
          // timestamp будет добавлен автоматически в addProduct
        };
        
        // Сохраняем в буфер
        addProduct(productData);
        savedCount++;
        logger.info(`💾 Сохранено оборудование в буфер #${savedCount}: ${productData.model} (${productData.hashrate})`);
      }
      
      if (savedCount > 0) {
        logger.info(`✅ Всего сохранено ${savedCount} товаров в буфер для отображения в веб-интерфейсе`);
        if (skippedCount > 0) {
          logger.warn(`⚠️  Пропущено ${skippedCount} товаров без модели`);
        }
      } else {
        logger.warn(`⚠️  Не удалось сохранить ни одного товара в буфер (пропущено: ${skippedCount})`);
      }
    } catch (bufferError) {
      logger.error('❌ Ошибка сохранения оборудования в буфер:', bufferError.message);
      logger.error('Стек ошибки:', bufferError.stack);
    }
    
    // Удаляем mediaData из JSON для логирования (слишком большой)
    const messageDataForLog = { ...messageData };
    if (messageDataForLog.mediaData) {
      messageDataForLog.mediaData = `[Base64 данные, размер: ${Buffer.from(messageData.mediaData, 'base64').length} байт]`;
    }
    
    logger.info('═'.repeat(80));
    logger.info('🌐 ЭТАП 5: ОТПРАВКА В ИНТЕРНЕТ-МАГАЗИН (SPRING BOOT API)');
    logger.info('═'.repeat(80));
    logger.info(`📊 Количество товаров: ${parsedData.products.length}`);
    logger.info(`📊 Тип операции: ${parsedData.operationType || 'не указан'}`);
    logger.info(`📊 Локация: ${parsedData.location || 'не указана'}`);
    logger.info('📤 Подготовка данных для отправки в Spring Boot API...');
    logger.info(`📞 Номер телефона: "${messageDataForLog.senderPhoneNumber || 'NULL/undefined'}"`);
    logger.info(`👤 Имя отправителя: "${messageDataForLog.senderName || 'NULL/undefined'}"`);
    logger.info(`🆔 ID отправителя: "${messageDataForLog.senderId || 'NULL/undefined'}"`);
    logger.info('📤 Отправляемые данные в интернет-магазин (JSON):', { 
      json: JSON.stringify(messageDataForLog, null, 2),
      messageData: messageDataForLog
    });
    
    // Отправляем в несколько API одновременно
    const apiConfig = monitoringConfig.api;
    
    // Список API для отправки: localhost и production
    const apiTargets = [
      {
        url: 'http://localhost:8050',
        endpoint: apiConfig.endpoint || '/api/webhook/whatsapp',
        apiKey: apiConfig.apiKey || null
      },
      {
        url: 'https://minerhive.ru',
        endpoint: apiConfig.endpoint || '/api/webhook/whatsapp',
        apiKey: apiConfig.apiKey || null
      }
    ];
    
    logger.info(`📡 Отправка в ${apiTargets.length} API endpoint(s)...`);
    apiTargets.forEach((target, index) => {
      logger.info(`   ${index + 1}. ${target.url}${target.endpoint}`);
    });
    
    logger.info('⏳ Вызов sendToMultipleAPIs()...');
    const results = await sendToMultipleAPIs(messageData, apiTargets);
    
    // Логируем результаты
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    logger.info(`✅ ЭТАП 5 ЗАВЕРШЕН: Результаты отправки: ${successCount} успешно, ${failCount} ошибок`);
    results.forEach((result, index) => {
      if (result.success) {
        logger.info(`   ✅ ${index + 1}. ${result.url}: успешно отправлено`);
      } else {
        logger.error(`   ❌ ${index + 1}. ${result.url}: ${result.error}`);
      }
    });
    
    logger.info('═'.repeat(80));
    logger.info('✅ ВСЕ ЭТАПЫ ОБРАБОТКИ СООБЩЕНИЯ ЗАВЕРШЕНЫ');
    logger.info('═'.repeat(80));
    logger.info('');
    
  } catch (error) {
    // Проверяем, не является ли это известной ошибкой getIsMyContact
    // Ошибка может быть в разных форматах: message, stack, или как строка
    let errorMessage = '';
    try {
      errorMessage = error?.message || String(error) || '';
      if (error?.stack) {
        errorMessage += ' ' + String(error.stack);
      }
    } catch (e) {
      errorMessage = String(error);
    }
    
    // Проверяем на наличие getIsMyContact в любом месте ошибки
    if (errorMessage.includes('getIsMyContact') || 
        errorMessage.includes('ContactMethods.getIsMyContact') ||
        errorMessage.includes('getIsMyContact is not a function')) {
      // Это известная ошибка, которая уже обработана - не логируем как критическую
      logger.info('ℹ️  Известная ошибка getIsMyContact в общем catch - игнорируем (уже обработана через fallback контакт)');
      return; // Прекращаем обработку, но не логируем как критическую ошибку
    }
    
    logger.error('═'.repeat(80));
    logger.error('❌ КРИТИЧЕСКАЯ ОШИБКА ПРИ ОБРАБОТКЕ СООБЩЕНИЯ');
    logger.error('═'.repeat(80));
    
    /**
     * Преобразует объект с числовыми ключами (строка в виде объекта) обратно в строку
     * Например: {"0": "a", "1": "b", "2": "c"} -> "abc"
     */
    const convertObjectToString = (obj) => {
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return null;
      }
      
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return null;
      }
      
      const numericKeys = [];
      for (const key of keys) {
        const num = Number(key);
        if (isNaN(num) || num < 0 || num.toString() !== key) {
          return null;
        }
        numericKeys.push(num);
      }
      
      numericKeys.sort((a, b) => a - b);
      
      let result = '';
      for (const key of numericKeys) {
        const value = obj[key.toString()];
        if (typeof value === 'string') {
          result += value;
        } else {
          return null;
        }
      }
      
      return result.length > 0 ? result : null;
    };
    
    // Детальное логирование ошибки
    try {
      // Тип ошибки
      if (error?.name) {
        logger.error(`Тип ошибки: ${error.name}`);
      }
      
      // Код ошибки
      if (error?.code) {
        logger.error(`Код ошибки: ${error.code}`);
      }
      
      // Сообщение об ошибке
      let errorMessage = 'Неизвестная ошибка';
      if (error?.message) {
        // Проверяем, не является ли error.message объектом с числовыми ключами
        if (typeof error.message === 'object' && error.message !== null && !Array.isArray(error.message)) {
          const converted = convertObjectToString(error.message);
          if (converted) {
            errorMessage = converted;
          } else {
            errorMessage = JSON.stringify(error.message);
          }
        } else {
          errorMessage = String(error.message);
        }
      } else if (error?.toString && typeof error.toString === 'function') {
        try {
          const str = error.toString();
          if (str && str !== '[object Object]') {
            errorMessage = str;
          }
        } catch (e) {
          // Игнорируем ошибку при вызове toString
        }
      }
      
      // Если сообщение пустое, пытаемся получить информацию из объекта
      if (!errorMessage || errorMessage.trim() === '' || errorMessage === 'Неизвестная ошибка') {
        try {
          // Проверяем, не является ли сам error объектом с числовыми ключами
          const converted = convertObjectToString(error);
          if (converted) {
            errorMessage = converted;
          } else {
            // Пытаемся сериализовать ошибку в JSON
            const errorJson = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
            if (errorJson && errorJson !== '{}' && errorJson !== 'null') {
              logger.error(`Данные об ошибке (JSON):`);
              logger.error(errorJson.substring(0, 2000) + (errorJson.length > 2000 ? '\n... [обрезано]' : ''));
            }
          }
        } catch (e) {
          // Если не удалось сериализовать, пробуем другие способы
          logger.error(`Данные об ошибке (попытка 1): ${String(error)}`);
          logger.error(`Данные об ошибке (попытка 2): ${JSON.stringify(error)}`);
        }
      }
      
      logger.error(`Ошибка: ${errorMessage}`);
      
      // Стек ошибки
      let errorStack = 'Стек недоступен';
      if (error?.stack) {
        // Проверяем, не является ли error.stack объектом с числовыми ключами
        if (typeof error.stack === 'object' && error.stack !== null && !Array.isArray(error.stack)) {
          const converted = convertObjectToString(error.stack);
          if (converted) {
            errorStack = converted;
          } else {
            errorStack = JSON.stringify(error.stack);
          }
        } else {
          errorStack = String(error.stack);
        }
      } else if (error?.stackTrace) {
        if (typeof error.stackTrace === 'object' && error.stackTrace !== null && !Array.isArray(error.stackTrace)) {
          const converted = convertObjectToString(error.stackTrace);
          if (converted) {
            errorStack = converted;
          } else {
            errorStack = JSON.stringify(error.stackTrace);
          }
        } else {
          errorStack = String(error.stackTrace);
        }
      }
      
      logger.error(`Стек:`);
      logger.error(errorStack);
      
      // Дополнительная информация, если есть
      if (error?.response) {
        logger.error(`HTTP ответ:`);
        logger.error(`  Статус: ${error.response.status} ${error.response.statusText || ''}`);
        if (error.response.data) {
          try {
            const responseData = typeof error.response.data === 'string' 
              ? error.response.data 
              : JSON.stringify(error.response.data, null, 2);
            logger.error(`  Тело ответа: ${responseData.substring(0, 1000)}${responseData.length > 1000 ? '... [обрезано]' : ''}`);
          } catch (e) {
            logger.error(`  Тело ответа: [не удалось сериализовать]`);
          }
        }
      }
      
      if (error?.config) {
        logger.error(`HTTP запрос:`);
        logger.error(`  URL: ${error.config.url || 'неизвестно'}`);
        logger.error(`  Метод: ${error.config.method || 'неизвестно'}`);
      }
      
    } catch (logError) {
      // Если даже логирование ошибки вызвало ошибку, логируем это
      logger.error(`ОШИБКА ПРИ ЛОГИРОВАНИИ ОШИБКИ: ${logError?.message || logError?.toString() || 'Неизвестная ошибка'}`);
      logger.error(`Исходная ошибка (сырые данные): ${String(error)}`);
    }
    
    logger.error('═'.repeat(80));
    logger.error('');
  }
}

/**
 * Проверяет, нужно ли мониторить чат
 */
function shouldMonitorChat(chat, monitoringConfig) {
  const { groups, personalChats, monitorAllGroups, monitorAllPersonal } = monitoringConfig;
  
  const chatId = chat.id?._serialized || '';
  const chatName = chat.name || '';
  
  logger.debug(`🔍 Детальная проверка мониторинга:`);
  logger.debug(`   Chat ID: ${chatId}`);
  logger.debug(`   Chat Name: "${chatName}"`);
  logger.debug(`   Is Group: ${chat.isGroup}`);
  
  if (chat.isGroup) {
    // Группа
    if (monitorAllGroups) {
      logger.debug(`   ✅ Мониторить все группы = true - мониторим`);
      return true;
    }
    
    if (groups.length === 0) {
      logger.debug(`   ❌ Список групп пуст - не мониторим`);
      return false;
    }
    
    logger.debug(`   📋 Проверяем ${groups.length} групп из списка`);
    
    const found = groups.some((chatIdOrName, index) => {
      const searchId = String(chatIdOrName).toLowerCase().trim();
      const normalizedChatId = chatId.toLowerCase().trim();
      const normalizedChatName = chatName.toLowerCase().trim();
      
      // Точное сравнение ID (предпочтительно)
      const exactMatch = normalizedChatId === searchId;
      
      // Частичное совпадение ID (для обратной совместимости)
      const partialIdMatch = normalizedChatId.includes(searchId) || searchId.includes(normalizedChatId);
      
      // Совпадение по имени
      const nameMatch = normalizedChatName && normalizedChatName.includes(searchId);
      
      const matches = exactMatch || partialIdMatch || nameMatch;
      
      if (matches) {
        logger.debug(`   ✅ Найдено совпадение [${index}]: "${chatIdOrName}"`);
        logger.debug(`      Точное совпадение ID: ${exactMatch}`);
        logger.debug(`      Частичное совпадение ID: ${partialIdMatch}`);
        logger.debug(`      Совпадение по имени: ${nameMatch}`);
      }
      
      return matches;
    });
    
    if (!found) {
      logger.debug(`   ❌ Не найдено совпадений`);
      logger.debug(`   📋 Первые 5 ID из списка для сравнения:`);
      groups.slice(0, 5).forEach((id, i) => {
        logger.debug(`      [${i}] "${id}"`);
      });
    }
    
    return found;
  } else {
    // Личный чат
    if (monitorAllPersonal) {
      logger.debug(`   ✅ Мониторить все личные = true - мониторим`);
      return true;
    }
    
    if (personalChats.length === 0) {
      logger.debug(`   ❌ Список личных чатов пуст - не мониторим`);
      return false;
    }
    
    logger.debug(`   📋 Проверяем ${personalChats.length} личных чатов из списка`);
    
    const found = personalChats.some((chatIdOrName, index) => {
      const searchId = String(chatIdOrName).toLowerCase().trim();
      const normalizedChatId = chatId.toLowerCase().trim();
      const normalizedContactName = chatName.toLowerCase().trim();
      
      // Точное сравнение ID
      const exactMatch = normalizedChatId === searchId;
      
      // Частичное совпадение ID
      const partialIdMatch = normalizedChatId.includes(searchId) || searchId.includes(normalizedChatId);
      
      // Совпадение по имени
      const nameMatch = normalizedContactName && normalizedContactName.includes(searchId);
      
      const matches = exactMatch || partialIdMatch || nameMatch;
      
      if (matches) {
        logger.debug(`   ✅ Найдено совпадение [${index}]: "${chatIdOrName}"`);
      }
      
      return matches;
    });
    
    if (!found) {
      logger.debug(`   ❌ Не найдено совпадений`);
    }
    
    return found;
  }
}

/**
 * Обрабатывает тестовое сообщение (симуляция сообщения из WhatsApp)
 * @param {Object|string} messageOrContent - Объект с данными сообщения или строка с текстом (для обратной совместимости)
 * @param {string} chatName - Название чата (например, "Test Group") - только если первый параметр строка
 * @param {string} senderName - Имя отправителя (например, "Test User") - только если первый параметр строка
 * @param {string} senderPhone - Телефон отправителя (например, "79999999999") - только если первый параметр строка
 * @param {boolean} isGroup - Является ли чат группой (по умолчанию true) - только если первый параметр строка
 */
export async function handleTestMessage(messageOrContent, chatName = 'Test Group', senderName = 'Test User', senderPhone = '79999999999', isGroup = true) {
  try {
    // Поддержка как нового формата (объект), так и старого (отдельные параметры)
    let content, promptId, chatId;
    if (typeof messageOrContent === 'object' && messageOrContent !== null) {
      content = messageOrContent.content;
      chatId = messageOrContent.chatId || null; // Реальный chatId из выбранной группы
      chatName = messageOrContent.chatName || 'Test Group';
      senderName = messageOrContent.senderName || 'Test User';
      senderPhone = messageOrContent.senderPhone || '79999999999';
      isGroup = messageOrContent.isGroup !== false;
      promptId = messageOrContent.promptId || null;
    } else {
      content = messageOrContent;
      chatId = null;
      promptId = null;
    }
    
    logger.info('═'.repeat(80));
    logger.info('🧪 ТЕСТОВОЕ СООБЩЕНИЕ (СИМУЛЯЦИЯ)');
    logger.info('═'.repeat(80));
    logger.info(`📱 Чат: ${chatName} (${isGroup ? 'группа' : 'личный чат'})`);
    logger.info(`📱 Chat ID: ${chatId || 'не указан (будет сгенерирован)'}`);
    logger.info(`👤 Отправитель: ${senderName} (${senderPhone})`);
    logger.info(`💬 Текст сообщения: ${content || '(пусто)'}`);
    if (promptId) {
      logger.info(`🎯 Используется промпт ID: ${promptId}`);
    }
    logger.info(`⏰ Время: ${new Date().toISOString()}`);
    logger.info('');

    // Создаем объект-заглушку сообщения, который будет обработан как обычное сообщение
    const testMessageId = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    // Используем реальный chatId если передан, иначе генерируем тестовый
    const testChatId = chatId || `test_chat_${chatName.replace(/\s+/g, '_').toLowerCase()}`;
    
    // Сохраняем тестовое сообщение в БД
    let whatsappMessageId = null;
    try {
      const savedMessage = await messageRepository.saveMessage({
        whatsappMessageId: testMessageId,
        chatId: testChatId,
        chatName: chatName,
        chatType: isGroup ? 'group' : 'personal',
        senderId: `test_sender_${senderPhone}`,
        senderName: senderName,
        senderPhoneNumber: senderPhone,
        content: content,
        messageType: 'chat',
        hasMedia: false,
        isForwarded: false,
        timestamp: new Date()
      });
      whatsappMessageId = savedMessage.id; // ID из БД
      logger.info(`✅ Тестовое сообщение сохранено в БД с ID: ${whatsappMessageId}`);
    } catch (dbError) {
      logger.warn(`⚠️  Не удалось сохранить тестовое сообщение в БД: ${dbError.message}`);
      // Продолжаем обработку даже если БД недоступна
    }
    
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

    // Проверяем задания для этого чата (если передан реальный chatId) - ДО отправки в Ollama
    let activeTasks = [];
    let taskPromptId = promptId; // Используем переданный promptId или из задания
    
    logger.info('');
    logger.info('═'.repeat(80));
    logger.info('📋 ПРОВЕРКА ЗАДАНИЙ ДЛЯ ТЕСТОВОГО СООБЩЕНИЯ');
    logger.info('═'.repeat(80));
    
    if (chatId) {
      logger.info(`📋 Chat ID: ${chatId}`);
      logger.info(`📋 Chat Name: ${chatName}`);
      try {
        activeTasks = await getActiveTasksForChat(chatId);
        logger.info(`📊 Найдено активных заданий: ${activeTasks.length}`);
        
        if (activeTasks.length > 0) {
          const task = activeTasks[0];
          logger.info(`📋 Задание: "${task.name}" (ID: ${task.id})`);
          logger.info(`📋 Prompt ID из задания: ${task.promptId}`);
          
          if (!taskPromptId) {
            taskPromptId = task.promptId; // Используем promptId из задания, если не передан явно
            logger.info(`✅ Используется промпт ID из задания: ${taskPromptId}`);
          } else {
            logger.info(`✅ Используется переданный промпт ID: ${taskPromptId}`);
          }
        } else {
          logger.info(`ℹ️  Для чата "${chatName}" (Chat ID: ${chatId}) не найдено активных заданий`);
          if (!taskPromptId) {
            logger.warn(`⚠️  Промпт ID не указан и заданий нет - будет использован дефолтный промпт`);
          }
        }
      } catch (taskError) {
        logger.error(`❌ Ошибка получения заданий для тестового сообщения: ${taskError.message}`);
        if (taskError.stack) {
          logger.error(`Стек: ${taskError.stack}`);
        }
      }
    } else {
      logger.warn(`⚠️  Chat ID не указан, проверка заданий пропущена`);
      if (!taskPromptId) {
        logger.warn(`⚠️  Промпт ID не указан - будет использован дефолтный промпт`);
      }
    }
    
    // Если есть задание, используем его promptId для Ollama
    if (taskPromptId && !promptId) {
      promptId = taskPromptId;
      logger.info(`🎯 Финальный промпт ID для Ollama: ${promptId}`);
    } else if (promptId) {
      logger.info(`🎯 Финальный промпт ID для Ollama: ${promptId} (передан явно)`);
    } else {
      logger.info(`🎯 Финальный промпт ID для Ollama: дефолтный (1)`);
    }
    
    logger.info('═'.repeat(80));
    logger.info('');

    // Парсим сообщение через Ollama Service (если доступен)
    let parsedData = null;
    try {
      logger.info('');
      logger.info('═'.repeat(80));
      logger.info('🤖 НАЧАЛО ПАРСИНГА ТЕСТОВОГО СООБЩЕНИЯ ЧЕРЕЗ OLLAMA SERVICE');
      logger.info('═'.repeat(80));
      logger.info('');
      
      // Проверяем условия для отправки в Ollama
      logger.info('📋 Проверка условий для отправки в Ollama Service:');
      logger.info(`   - whatsappMessageId: ${whatsappMessageId ? '✅ есть' : '❌ отсутствует'}`);
      logger.info(`   - content: ${content && content.trim().length > 0 ? `✅ есть (${content.length} символов)` : '❌ пустой'}`);
      logger.info(`   - promptId: ${promptId || 'дефолтный (1)'}`);
      logger.info('');
      
      // Используем Ollama Service Client для отправки в очередь
      if (whatsappMessageId && content && content.trim().length > 0) {
        try {
          logger.info('📤 ШАГ 1: Вызов ollamaServiceClient.parseMessage()...');
          logger.info(`   Параметры:`);
          logger.info(`   - message: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
          logger.info(`   - whatsappMessageId: ${whatsappMessageId}`);
          logger.info(`   - promptId: ${promptId || 'дефолтный'}`);
          logger.info(`   - callbackUrl: будет использован по умолчанию`);
          logger.info(`   - logResponse: true`);
          logger.info('');
          
          const result = await ollamaServiceClient.parseMessage(
            content,
            whatsappMessageId,
            promptId || null, // Используем promptId (может быть null для дефолтного)
            null, // callback_url - будет использован по умолчанию
            true // logResponse - логируем ответ
          );
          
          logger.info('');
          logger.info('✅ ШАГ 2: Ответ от Ollama Service получен:');
          logger.info(`   - success: ${result.success || 'N/A'}`);
          logger.info(`   - task_id: ${result.task_id || 'N/A'}`);
          logger.info(`   - status: ${result.status || 'N/A'}`);
          logger.info(`   - message: ${result.message || 'N/A'}`);
          logger.info('');
          
          if (result.task_id) {
            logger.info(`✅ Тестовое сообщение отправлено в Ollama Service (Task ID: ${result.task_id})`);
            
            // Обновляем статус сообщения в БД
            if (whatsappMessageId && result.task_id) {
              logger.info('📋 ШАГ 3: Обновление статуса сообщения в БД...');
              await messageRepository.updateStatus(whatsappMessageId, 'queued', result.task_id, promptId || 1);
              logger.info(`✅ Статус сообщения #${whatsappMessageId} обновлен на 'queued' (Task ID: ${result.task_id}, Prompt ID: ${promptId || 1})`);
            }
          } else {
            logger.warn(`⚠️  Ollama Service не вернул task_id в ответе`);
            logger.warn(`   Ответ: ${JSON.stringify(result)}`);
          }
          
          // Пока не ждем результата - он придет через callback
          // parsedData будет null, так как обработка асинхронная
          parsedData = null;
        } catch (ollamaError) {
          logger.error('═'.repeat(80));
          logger.error('❌ ОШИБКА ПРИ ВЫЗОВЕ ollamaServiceClient.parseMessage()');
          logger.error('═'.repeat(80));
          logger.error(`Ошибка: ${ollamaError.message}`);
          if (ollamaError.response) {
            logger.error(`HTTP статус: ${ollamaError.response.status}`);
            logger.error(`Данные ответа: ${JSON.stringify(ollamaError.response.data)}`);
          }
          if (ollamaError.stack) {
            logger.error(`Стек: ${ollamaError.stack}`);
          }
          logger.error('═'.repeat(80));
          logger.error('');
          // Продолжаем обработку без парсинга
        }
      } else {
        logger.warn('═'.repeat(80));
        logger.warn('⚠️  НЕ ОТПРАВЛЯЕМ В OLLAMA SERVICE');
        logger.warn('═'.repeat(80));
        logger.warn(`   whatsappMessageId: ${whatsappMessageId ? '✅' : '❌ отсутствует'}`);
        logger.warn(`   content: ${content && content.trim().length > 0 ? '✅' : '❌ пустой'}`);
        logger.warn('═'.repeat(80));
        logger.warn('');
      }
      
      logger.info('');
      
      // Парсинг будет выполнен асинхронно в Ollama Service
      // Результат придет через callback, поэтому parsedData остается null
      logger.info('✅ Тестовое сообщение отправлено в очередь Ollama Service');
      logger.info('   Результат парсинга будет получен через callback');
      logger.info('');
    } catch (ollamaError) {
      logger.error('═'.repeat(80));
      logger.error('❌ КРИТИЧЕСКАЯ ОШИБКА ПРИ ОТПРАВКЕ ТЕСТОВОГО СООБЩЕНИЯ В OLLAMA SERVICE');
      logger.error('═'.repeat(80));
      logger.error(`Ошибка: ${ollamaError.message}`);
      if (ollamaError.stack) {
        logger.error(`Стек: ${ollamaError.stack}`);
      }
      logger.error('═'.repeat(80));
      logger.error('');
      // Продолжаем работу даже если Ollama Service недоступен
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
    
    // Отправляем в несколько API одновременно
    const apiTargets = [
      {
        url: 'http://localhost:8050',
        endpoint: apiConfig.endpoint || '/api/webhook/whatsapp',
        apiKey: apiConfig.apiKey || null
      },
      {
        url: 'https://minerhive.ru',
        endpoint: apiConfig.endpoint || '/api/webhook/whatsapp',
        apiKey: apiConfig.apiKey || null
      }
    ];
    
    try {
      const results = await sendToMultipleAPIs(messageData, apiTargets);
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      logger.info(`📊 Результаты отправки тестового сообщения: ${successCount} успешно, ${failCount} ошибок`);
      results.forEach(result => {
        if (result.success) {
          logger.info(`✅ ${result.url}: успешно отправлено`);
        } else {
          logger.error(`❌ ${result.url}: ${result.error}`);
        }
      });
      
      logger.info('✅ Тестовое сообщение успешно обработано и отправлено в Spring Boot API');
      logger.info('═'.repeat(80));
      logger.info('');
      
      return {
        success: true,
        messageData: messageDataForLog,
        parsedData: parsedData,
        results: results,
        activeTasks: activeTasks.length,
        promptId: taskPromptId || promptId
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

/**
 * Получает клиент Ollama с очередью (для использования в веб-интерфейсе)
 * УСТАРЕЛО: Теперь используется HTTP API через ollamaServiceClient
 */
export function getOllamaQueueClient() {
  logger.warn('⚠️  getOllamaQueueClient() устарела, используйте ollamaServiceClient');
  return null; // Возвращаем null, так как теперь используется HTTP API
}
