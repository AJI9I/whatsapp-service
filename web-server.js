import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getClient, getClientStatus, initializeClient, destroyClient } from './whatsapp-client.js';
import { initializeMessageHandler, getOllamaQueueClient } from './message-handler.js';
import { 
  getMonitoringConfig, 
  updateApiConfig, 
  updateMonitoredGroups, 
  updateMonitoredPersonalChats,
  updateLoggingConfig,
  loadConfig
} from './config-manager.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { getLogs, clearLogs } from './log-buffer.js';
import { getProducts, clearProducts } from './products-buffer.js';
import { messageRepository } from './message-repository.js';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.WEB_PORT || '3000');

// Отслеживание последнего количества товаров для логирования только при изменении
let lastProductCount = 0;

// Кэш для списка чатов
const chatsCache = {
  data: null,
  timestamp: null,
  maxAge: 5 * 60 * 1000, // 5 минут в миллисекундах
  isUpdating: false,
  updatePromise: null
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит для больших сообщений

// Логирование всех запросов для отладки (ВАЖНО: должно быть ПЕРЕД всеми маршрутами)
app.use((req, res, next) => {
  const logMessage = `📥 [${new Date().toISOString()}] ${req.method} ${req.path} - IP: ${req.ip || req.connection.remoteAddress || 'unknown'}`;
  logger.info(logMessage);
  console.log(logMessage); // Дублируем в консоль для немедленного отображения
  next();
});

// Маршруты должны быть ДО статических файлов
/**
 * Корневой путь - веб-интерфейс
 */
app.get('/', (req, res) => {
  logger.info(`🎯 МАРШРУТ / ВЫЗВАН!`);
  const indexPath = path.join(__dirname, 'public', 'index.html');
  logger.info(`📄 Запрос /, отправка файла: ${indexPath}`);
  
  if (!fs.existsSync(indexPath)) {
    logger.error(`❌ Файл не найден: ${indexPath}`);
    return res.status(404).send(`File not found: ${indexPath}`);
  }
  
  logger.info(`✅ Файл найден, отправляю...`);
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error(`❌ Error serving index.html: ${err.message}`);
      res.status(500).send('Error loading index page');
    } else {
      logger.info(`✅ index.html отправлен успешно`);
    }
  });
});

/**
 * Тестовый маршрут для проверки работы
 */
app.get('/test-route', (req, res) => {
  logger.info(`🧪 ТЕСТОВЫЙ МАРШРУТ /test-route ВЫЗВАН!`);
  res.send('Test route works!');
});

/**
 * Страницы меню
 */
app.get('/restore-contacts', (req, res) => {
  logger.info(`🎯🎯🎯 МАРШРУТ /restore-contacts ВЫЗВАН! 🎯🎯🎯`);
  logger.info(`   Request method: ${req.method}`);
  logger.info(`   Request path: ${req.path}`);
  logger.info(`   Request url: ${req.url}`);
  
  const restorePath = path.join(__dirname, 'public', 'restore-contacts.html');
  const absolutePath = path.resolve(restorePath);
  logger.info(`📄 Абсолютный путь к файлу: ${absolutePath}`);
  
  // Двойная проверка существования файла
  const fileExists = fs.existsSync(restorePath);
  logger.info(`   Файл существует: ${fileExists}`);
  
  if (!fileExists) {
    logger.error(`❌ Файл не найден: ${absolutePath}`);
    if (!res.headersSent) {
      return res.status(404).send(`File not found: ${absolutePath}`);
    }
    return;
  }
  
  logger.info(`✅ Файл найден, отправляю через res.sendFile()...`);
  res.sendFile('restore-contacts.html', {
    root: path.join(__dirname, 'public')
  }, (err) => {
    if (err) {
      logger.error(`❌ Error serving restore-contacts.html: ${err.message}`);
      logger.error(`   Path: ${absolutePath}`);
      logger.error(`   Error code: ${err.code}`);
      if (!res.headersSent) {
        res.status(500).send(`Error loading restore contacts page: ${err.message}`);
      }
    } else {
      logger.info(`✅✅✅ restore-contacts.html отправлен успешно ✅✅✅`);
    }
  });
});

app.get('/messages', (req, res, next) => {
  logger.info(`🎯🎯🎯 МАРШРУТ /messages ВЫЗВАН! 🎯🎯🎯`);
  logger.info(`   Request method: ${req.method}`);
  logger.info(`   Request path: ${req.path}`);
  logger.info(`   Request url: ${req.url}`);
  logger.info(`   __dirname: ${__dirname}`);
  
  const messagesPath = path.join(__dirname, 'public', 'messages.html');
  const absolutePath = path.resolve(messagesPath);
  logger.info(`📄 Абсолютный путь к файлу: ${absolutePath}`);
  
  // Двойная проверка существования файла
  const fileExists = fs.existsSync(absolutePath);
  logger.info(`   Файл существует: ${fileExists}`);
  
  if (!fileExists) {
    logger.error(`❌ Файл не найден: ${absolutePath}`);
    if (!res.headersSent) {
      return res.status(404).send(`File not found: ${absolutePath}`);
    }
    return;
  }
  
  logger.info(`✅ Файл найден, отправляю через res.sendFile()...`);
  res.sendFile('messages.html', {
    root: path.join(__dirname, 'public')
  }, (err) => {
    if (err) {
      logger.error(`❌ Error serving messages.html: ${err.message}`);
      logger.error(`   Path: ${absolutePath}`);
      logger.error(`   Error code: ${err.code}`);
      logger.error(`   Error stack: ${err.stack}`);
      if (!res.headersSent) {
        res.status(500).send(`Error loading messages page: ${err.message}`);
      }
    } else {
      logger.info(`✅✅✅ messages.html отправлен успешно ✅✅✅`);
    }
  });
});

app.get('/chats', (req, res) => {
  logger.info(`🎯 МАРШРУТ /chats ВЫЗВАН!`);
  const chatsPath = path.join(__dirname, 'public', 'chats.html');
  logger.info(`📄 Запрос /chats, отправка файла: ${chatsPath}`);
  logger.info(`📄 __dirname: ${__dirname}`);
  
  // Проверяем существование файла
  if (!fs.existsSync(chatsPath)) {
    logger.error(`❌ Файл не найден: ${chatsPath}`);
    return res.status(404).send(`File not found: ${chatsPath}`);
  }
  
  logger.info(`✅ Файл найден, отправляю...`);
  res.sendFile(chatsPath, (err) => {
    if (err) {
      logger.error(`❌ Error serving chats.html: ${err.message}`);
      logger.error(`   Path: ${chatsPath}`);
      res.status(500).send(`Error loading chats page: ${err.message}`);
    } else {
      logger.info(`✅ chats.html отправлен успешно`);
    }
  });
});

app.get('/settings', (req, res) => {
  logger.info(`🎯 МАРШРУТ /settings ВЫЗВАН!`);
  // Пока перенаправляем на главную, т.к. настройки уже есть там
  res.redirect('/');
});

app.get('/logs', (req, res) => {
  logger.info(`🎯 МАРШРУТ /logs ВЫЗВАН!`);
  const logsPath = path.join(__dirname, 'public', 'logs.html');
  logger.info(`📄 Запрос /logs, отправка файла: ${logsPath}`);
  
  if (!fs.existsSync(logsPath)) {
    logger.error(`❌ Файл не найден: ${logsPath}`);
    return res.status(404).send(`File not found: ${logsPath}`);
  }
  
  logger.info(`✅ Файл найден, отправляю...`);
  res.sendFile(logsPath, (err) => {
    if (err) {
      logger.error(`❌ Error serving logs.html: ${err.message}`);
      logger.error(`   Path: ${logsPath}`);
      res.status(500).send(`Error loading logs page: ${err.message}`);
    } else {
      logger.info(`✅ logs.html отправлен успешно`);
    }
  });
});

app.get('/api-test', (req, res) => {
  logger.info(`🎯 МАРШРУТ /api-test ВЫЗВАН!`);
  const apiTestPath = path.join(__dirname, 'public', 'api-test.html');
  logger.info(`📄 Запрос /api-test, отправка файла: ${apiTestPath}`);
  
  if (!fs.existsSync(apiTestPath)) {
    logger.error(`❌ Файл не найден: ${apiTestPath}`);
    return res.status(404).send(`File not found: ${apiTestPath}`);
  }
  
  logger.info(`✅ Файл найден, отправляю...`);
  res.sendFile(apiTestPath, (err) => {
    if (err) {
      logger.error(`❌ Error serving api-test.html: ${err.message}`);
      logger.error(`   Path: ${apiTestPath}`);
      res.status(500).send(`Error loading api-test page: ${err.message}`);
    } else {
      logger.info(`✅ api-test.html отправлен успешно`);
    }
  });
});

// Статические файлы после маршрутов страниц
// ВАЖНО: маршруты страниц (/, /messages, /chats, /logs, /settings) уже обработаны выше
// express.static будет обрабатывать только реальные файлы (CSS, JS, изображения и т.д.)
// и НЕ будет обрабатывать маршруты без расширения файла

// API Routes - ВАЖНО: должны быть ДО статических файлов!

/**
 * Получить статус WhatsApp клиента
 */
app.get('/api/status', (req, res) => {
  const status = getClientStatus();
  const monitoringConfig = getMonitoringConfig();
  
  res.json({
    ...status,
    monitoring: monitoringConfig
  });
});

/**
 * Переподключить WhatsApp клиент
 * POST /api/reconnect
 */
app.post('/api/reconnect', async (req, res) => {
  try {
    logger.info('🔄 Запрос на переподключение WhatsApp клиента...');
    
    // Уничтожаем текущий клиент
    await destroyClient();
    logger.info('✅ Текущий клиент уничтожен');
    
    // Инициализируем новый клиент
    const { config } = await import('./config.js');
    await initializeClient(config.sessionPath);
    logger.info('✅ Новый клиент инициализирован');
    
    res.json({ 
      success: true, 
      message: 'Клиент переподключается...',
      status: getClientStatus().status
    });
  } catch (error) {
    logger.error(`❌ Ошибка переподключения клиента: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Получить QR-код (если доступен)
 */
app.get('/api/qrcode', async (req, res) => {
  const status = getClientStatus();
  
  if (status.qrCode) {
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(status.qrCode);
      res.json({ qrCode: qrCodeDataUrl, status: status.status });
    } catch (error) {
      logger.error(`Ошибка генерации QR-кода: ${error.message}`);
      res.status(500).json({ error: 'Ошибка генерации QR-кода' });
    }
  } else {
    res.json({ qrCode: null, status: status.status });
  }
});

/**
 * Получить URL Ollama Service
 */
app.get('/api/ollama-service-url', (req, res) => {
  try {
    const ollamaServiceUrl = process.env.OLLAMA_SERVICE_URL || 'http://localhost:4000';
    res.json({ url: ollamaServiceUrl });
  } catch (error) {
    logger.error(`Ошибка получения URL Ollama Service: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить информацию о модели Ollama
 */
app.get('/api/model-info', async (req, res) => {
  try {
    const { createOllamaClient } = await import('./ollama-client.js');
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.1';
    
    const ollamaClient = createOllamaClient(ollamaUrl, model);
    
    try {
      const modelInfoRaw = await ollamaClient.getModelInfo();
      
      // Форматируем данные для фронтенда
      const formattedInfo = {
        model: model,
        ollamaUrl: ollamaUrl,
        architecture: modelInfoRaw?.details?.family || modelInfoRaw?.modelfile?.split('\n').find(line => line.includes('architecture'))?.split(' ')[1] || 'Неизвестно',
        parameters: modelInfoRaw?.details?.parameter_size || modelInfoRaw?.modelfile?.split('\n').find(line => line.includes('parameter'))?.split(' ')[1] || 'Неизвестно',
        contextSize: modelInfoRaw?.details?.context_size || modelInfoRaw?.modelfile?.split('\n').find(line => line.includes('context'))?.match(/\d+/)?.[0] || null,
        contextSizeFormatted: null,
        embeddingLength: modelInfoRaw?.details?.embedding_length || null,
        quantization: modelInfoRaw?.details?.quantization_level || null,
        details: true,
        fullInfo: modelInfoRaw
      };
      
      // Форматируем размер контекста
      if (formattedInfo.contextSize) {
        const ctxSize = parseInt(formattedInfo.contextSize);
        if (ctxSize >= 1024 * 1024) {
          formattedInfo.contextSizeFormatted = `${(ctxSize / (1024 * 1024)).toFixed(1)}M токенов`;
        } else if (ctxSize >= 1024) {
          formattedInfo.contextSizeFormatted = `${(ctxSize / 1024).toFixed(1)}K токенов`;
        } else {
          formattedInfo.contextSizeFormatted = `${ctxSize} токенов`;
        }
      } else {
        formattedInfo.contextSizeFormatted = 'Неизвестно';
      }
      
      res.json(formattedInfo);
    } catch (ollamaError) {
      // Если Ollama недоступен, возвращаем базовую информацию
      logger.warn(`Ollama недоступен: ${ollamaError.message}`);
      res.json({
        model: model,
        ollamaUrl: ollamaUrl,
        architecture: 'Неизвестно',
        parameters: 'Неизвестно',
        contextSize: null,
        contextSizeFormatted: 'Неизвестно (Ollama недоступен)',
        embeddingLength: null,
        quantization: null,
        details: false,
        error: `Ollama недоступен: ${ollamaError.message}`,
        fullInfo: null
      });
    }
  } catch (error) {
    logger.error(`Ошибка получения информации о модели: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить участников группы
 * GET /api/chats/:chatId/participants
 */
app.get('/api/chats/:chatId/participants', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const chatId = req.params.chatId;
    logger.info(`Получение участников группы: ${chatId}`);
    
    try {
      const chat = await client.getChatById(chatId);
      
      if (!chat || !chat.isGroup) {
        return res.status(400).json({ error: 'Чат не найден или не является группой' });
      }
      
      const participants = await chat.participants;
      
      const participantsData = participants.map(p => ({
        id: p.id?._serialized || p.id?.user || 'unknown',
        userId: p.id?.user || 'unknown',
        number: p.number || p.id?.user || 'unknown',
        name: p.name || p.pushname || p.number || 'Unknown',
        pushname: p.pushname || null,
        isAdmin: p.isAdmin || false,
        isSuperAdmin: p.isSuperAdmin || false
      }));
      
      res.json({
        chatId: chatId,
        chatName: chat.name || 'Unknown',
        participants: participantsData,
        count: participantsData.length
      });
    } catch (error) {
      logger.error(`Ошибка получения участников группы: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  } catch (error) {
    logger.error(`Ошибка получения участников: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Найти контакт по ID в участниках всех групп
 * GET /api/find-contact/:contactId
 */
app.get('/api/find-contact/:contactId', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const contactId = req.params.contactId;
    const userId = contactId.split('@')[0];
    const formattedId = contactId.includes('@') ? contactId : `${contactId}@c.us`;
    
    logger.info(`Поиск контакта: ${contactId} (user: ${userId})`);
    
    const foundIn = [];
    const allGroups = [];
    
    try {
      const chats = await client.getChats();
      
      for (const chat of chats) {
        if (!chat.isGroup) continue;
        
        try {
          const participants = await chat.participants;
          
          const found = participants.find(p => {
            const pId = p.id?._serialized || '';
            const pUser = p.id?.user || '';
            const pNumber = p.number || '';
            
            return pId === formattedId || 
                   pId === contactId ||
                   pUser === userId ||
                   pNumber === userId ||
                   pNumber === contactId;
          });
          
          if (found) {
            foundIn.push({
              chatId: chat.id?._serialized,
              chatName: chat.name,
              contact: {
                id: found.id?._serialized || found.id?.user || 'unknown',
                userId: found.id?.user || 'unknown',
                number: found.number || found.id?.user || 'unknown',
                name: found.name || found.pushname || found.number || 'Unknown',
                pushname: found.pushname || null
              }
            });
          }
          
          // Сохраняем информацию о всех группах для отображения
          allGroups.push({
            chatId: chat.id?._serialized,
            chatName: chat.name,
            participantCount: participants.length
          });
          
        } catch (error) {
          logger.warn(`Ошибка получения участников группы ${chat.name}: ${error.message}`);
        }
      }
      
      res.json({
        contactId: contactId,
        userId: userId,
        formattedId: formattedId,
        found: foundIn.length > 0,
        foundIn: foundIn,
        allGroups: allGroups,
        totalGroups: allGroups.length
      });
      
    } catch (error) {
      logger.error(`Ошибка поиска контакта: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  } catch (error) {
    logger.error(`Ошибка поиска контакта: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Функция для получения и обработки чатов из WhatsApp
 * @param {boolean} force - Принудительное обновление, игнорируя кэш
 * @returns {Promise<Object>} Объект с groups и personalChats
 */
async function fetchAndProcessChats(force = false) {
  const requestStartTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  logger.info('═'.repeat(80));
  logger.info(`📋 НАЧАЛО ПОЛУЧЕНИЯ ЧАТОВ [ID: ${requestId}] ${force ? '(ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ)' : ''}`);
  logger.info('═'.repeat(80));
  
  try {
    logger.info(`📋 ШАГ 1: Получение клиента и статуса...`);
    const client = getClient();
    const status = getClientStatus();
    
    logger.info(`📊 Статус клиента: ${status.status}`);
    logger.info(`📊 Готов: ${status.isReady}`);
    logger.info(`📊 Подключен: ${status.isConnected}`);
    
    if (!client) {
      logger.warn('⚠️  WhatsApp клиент не инициализирован');
      throw new Error('WhatsApp клиент не инициализирован');
    }
    
    if (!status.isReady) {
      logger.warn(`⚠️  WhatsApp клиент не готов (статус: ${status.status})`);
      logger.warn(`⚠️  Возможные причины: клиент еще подключается, требуется сканирование QR-кода, или произошла ошибка`);
      throw new Error(`WhatsApp клиент не готов (статус: ${status.status})`);
    }
    
    logger.info(`📋 ШАГ 2: Получение списка чатов через client.getChats()...`);
    const startTime = Date.now();
    
    // Добавляем таймаут для получения чатов (60 секунд)
    const getChatsPromise = client.getChats();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: client.getChats() превысил 60 секунд')), 60000)
    );
    
    let chats;
    try {
      chats = await Promise.race([getChatsPromise, timeoutPromise]);
    } catch (getChatsError) {
      logger.error(`❌ Ошибка при получении чатов: ${getChatsError.message}`);
      throw getChatsError;
    }
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Получено чатов: ${chats.length} (за ${duration}мс)`);
    
    // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ: проверяем структуру первых чатов
    if (chats.length > 0) {
      logger.info(`📋 ДЕТАЛЬНАЯ ПРОВЕРКА ПЕРВЫХ ЧАТОВ:`);
      for (let i = 0; i < Math.min(5, chats.length); i++) {
        const chat = chats[i];
        logger.info(`   Чат ${i + 1}:`);
        logger.info(`      - Тип объекта: ${chat.constructor?.name || typeof chat}`);
        logger.info(`      - ID: ${chat.id?._serialized || chat.id || 'N/A'}`);
        logger.info(`      - Name: ${chat.name || 'N/A'}`);
        logger.info(`      - isGroup: ${chat.isGroup} (тип: ${typeof chat.isGroup})`);
        logger.info(`      - has isGroup: ${'isGroup' in chat}`);
        logger.info(`      - Все свойства: ${Object.keys(chat).slice(0, 15).join(', ')}`);
      }
    } else {
      logger.warn(`⚠️  ВНИМАНИЕ: Получен ПУСТОЙ массив чатов!`);
      logger.warn(`⚠️  Возможные причины:`);
      logger.warn(`      1. WhatsApp клиент не подключен`);
      logger.warn(`      2. Нет чатов в аккаунте`);
      logger.warn(`      3. Ошибка при получении чатов`);
    }
    
    const groups = [];
    const personalChats = [];
    let errorCount = 0;
    let processedCount = 0;
    
    logger.info(`📋 ШАГ 3: Начало обработки чатов...`);
    logger.info(`📊 Всего чатов для обработки: ${chats.length}`);
    const processStartTime = Date.now();
    
    // Обрабатываем чаты БЕЗ дополнительных операций для максимальной скорости
    // Просто собираем данные из уже полученных чатов
    logger.info(`📋 Начало быстрой обработки ${chats.length} чатов...`);
    
    for (let i = 0; i < chats.length; i++) {
      const chat = chats[i];
      
      // Логируем прогресс каждые 100 чатов
      if (i > 0 && i % 100 === 0) {
        const elapsed = Date.now() - processStartTime;
        const avgTime = elapsed / i;
        const remaining = chats.length - i;
        const estimatedTime = remaining * avgTime;
        logger.info(`📊 Прогресс: ${i}/${chats.length} (${Math.round(i / chats.length * 100)}%) | Прошло: ${elapsed}мс | Осталось ~${Math.round(estimatedTime)}мс`);
      }
      
      try {
        processedCount++;
        
        // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ для первых 10 чатов и всех групп
        const shouldLogDetails = i < 10 || chat.isGroup;
        
        if (shouldLogDetails) {
          logger.info(`📋 Чат ${i + 1}/${chats.length}:`);
          logger.info(`   - ID: ${chat.id?._serialized || 'N/A'}`);
          logger.info(`   - Name: ${chat.name || 'N/A'}`);
          logger.info(`   - isGroup: ${chat.isGroup}`);
          logger.info(`   - Type: ${typeof chat.isGroup}`);
          logger.info(`   - has isGroup property: ${'isGroup' in chat}`);
          logger.info(`   - Chat object keys: ${Object.keys(chat).slice(0, 10).join(', ')}`);
        }
        
        // Минимальная обработка - только необходимые данные
        let chatName = chat.name || 'Без имени';
        
        // Для личных чатов извлекаем номер из ID если имя не указано
        if (!chat.isGroup && !chat.name && chat.id?._serialized) {
          const idMatch = chat.id._serialized.match(/(\d+)@c\.us/);
          if (idMatch) {
            chatName = idMatch[1];
          } else {
            chatName = chat.id._serialized;
          }
        }
        
        const chatInfo = {
          id: chat.id._serialized,
          name: chatName,
          isGroup: chat.isGroup,
          unreadCount: chat.unreadCount || 0
        };
        
        // Дополнительная проверка: если isGroup не определен, пробуем определить по ID
        if (chatInfo.isGroup === undefined || chatInfo.isGroup === null) {
          // Группы обычно имеют формат: XXXXXX@g.us
          if (chat.id?._serialized && chat.id._serialized.includes('@g.us')) {
            chatInfo.isGroup = true;
            if (shouldLogDetails) {
              logger.info(`   ⚠️  isGroup был undefined, определен как true по ID (@g.us)`);
            }
          } else {
            chatInfo.isGroup = false;
            if (shouldLogDetails) {
              logger.info(`   ⚠️  isGroup был undefined, определен как false (личный чат)`);
            }
          }
        }
        
        if (chatInfo.isGroup) {
          groups.push(chatInfo);
          if (shouldLogDetails) {
            logger.info(`   ✅ Добавлена ГРУППА: ${chatName}`);
          }
        } else {
          personalChats.push(chatInfo);
          if (shouldLogDetails && i < 10) {
            logger.info(`   ✅ Добавлен ЛИЧНЫЙ ЧАТ: ${chatName}`);
          }
        }
      } catch (error) {
        errorCount++;
        // Логируем только критические ошибки
        if (error.message.includes('Protocol') || error.message.includes('Target closed') || errorCount <= 5) {
          logger.warn(`❌ Ошибка обработки чата ${i + 1}/${chats.length}: ${error.message}`);
        }
      }
    }
    
    const processDuration = Date.now() - processStartTime;
    logger.info(`⏱️  Время обработки всех чатов: ${processDuration}мс (среднее: ${Math.round(processDuration / chats.length)}мс на чат)`);
    
    const totalDuration = Date.now() - requestStartTime;
    logger.info('═'.repeat(80));
    logger.info(`✅ ОБРАБОТКА ЗАВЕРШЕНА`);
    logger.info(`   Всего чатов: ${chats.length}`);
    logger.info(`   Обработано: ${processedCount}`);
    logger.info(`   Групп: ${groups.length}`);
    logger.info(`   Личных: ${personalChats.length}`);
    logger.info(`   Ошибок: ${errorCount}`);
    logger.info(`   Время получения: ${duration}мс`);
    logger.info(`   Время обработки: ${processDuration}мс`);
    logger.info(`   Общее время запроса: ${totalDuration}мс (${(totalDuration / 1000).toFixed(2)} сек)`);
    logger.info('═'.repeat(80));
    logger.info(`📋 ШАГ 4: Отправка ответа клиенту...`);
    logger.info(`⏱️ Общее время обработки запроса: ${totalDuration}мс`);
    
    const responseData = { 
      groups, 
      personalChats,
      status: status.status,
      total: chats.length
    };
    
    const responseSize = JSON.stringify(responseData).length;
    logger.info(`📊 Размер ответа: ${responseSize} символов (${(responseSize / 1024).toFixed(2)} KB)`);
    logger.info(`📊 Групп в ответе: ${groups.length}`);
    logger.info(`📊 Личных чатов в ответе: ${personalChats.length}`);
    
    const finalDuration = Date.now() - requestStartTime;
    logger.info('═'.repeat(80));
    logger.info(`✅ ЧАТЫ УСПЕШНО ПОЛУЧЕНЫ [ID: ${requestId}]`);
    logger.info(`⏱️ Общее время: ${finalDuration}мс (${(finalDuration / 1000).toFixed(2)} секунд)`);
    logger.info(`📊 Итого: ${groups.length} групп, ${personalChats.length} личных чатов`);
    logger.info('═'.repeat(80));
    
    const result = {
      groups,
      personalChats,
      status: status.status,
      total: chats.length,
      cached: false,
      timestamp: Date.now()
    };
    
    // Обновляем кэш
    chatsCache.data = result;
    chatsCache.timestamp = Date.now();
    chatsCache.isUpdating = false;
    chatsCache.updatePromise = null;
    
    logger.info(`💾 Кэш обновлен: ${groups.length} групп, ${personalChats.length} личных чатов`);
    
    return result;
  } catch (error) {
    chatsCache.isUpdating = false;
    chatsCache.updatePromise = null;
    
    const errorDuration = Date.now() - requestStartTime;
    logger.error('═'.repeat(80));
    logger.error(`❌ КРИТИЧЕСКАЯ ОШИБКА ПОЛУЧЕНИЯ СПИСКА ЧАТОВ [ID: ${requestId}]`);
    logger.error('═'.repeat(80));
    logger.error(`⏰ Время ошибки: ${new Date().toISOString()}`);
    logger.error(`⏱️ Время до ошибки: ${errorDuration}мс`);
    logger.error(`❌ Ошибка: ${error.message}`);
    logger.error(`📋 Тип ошибки: ${error.name}`);
    if (error.stack) {
      logger.error(`📋 Stack trace: ${error.stack}`);
    }
    logger.error('═'.repeat(80));
    
    throw error;
  }
}

/**
 * Получить список чатов (с кэшированием)
 * ВАЖНО: Этот маршрут должен быть ДО статических файлов
 */
app.get('/api/chats', async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  const force = req.query.force === 'true' || req.query.force === '1';
  
  // НЕМЕДЛЕННОЕ логирование в консоль и файл
  const immediateLog = `🚨 ОБРАБОТЧИК /api/chats ВЫЗВАН! [ID: ${requestId}] ${force ? '(ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ)' : ''}`;
  console.log(immediateLog);
  logger.info(immediateLog);
  
  try {
    logger.info('═'.repeat(80));
    logger.info(`📥 ЗАПРОС /api/chats [ID: ${requestId}]`);
    logger.info(`⏰ Время запроса: ${new Date().toISOString()}`);
    logger.info(`📡 IP: ${req.ip || req.connection.remoteAddress || 'unknown'}`);
    logger.info(`📋 URL: ${req.url}`);
    logger.info(`📋 Method: ${req.method}`);
    logger.info(`📋 Force update: ${force}`);
    logger.info('═'.repeat(80));
    
    // Проверяем кэш (если не принудительное обновление)
    if (!force && chatsCache.data && chatsCache.timestamp) {
      const cacheAge = Date.now() - chatsCache.timestamp;
      const isCacheValid = cacheAge < chatsCache.maxAge;
      
      if (isCacheValid) {
        logger.info(`💾 Используем кэш (возраст: ${(cacheAge / 1000).toFixed(1)} сек, лимит: ${(chatsCache.maxAge / 1000).toFixed(0)} сек)`);
        console.log(`💾 Возвращаем кэш [ID: ${requestId}]: ${chatsCache.data.groups.length} групп, ${chatsCache.data.personalChats.length} личных чатов`);
        
        const cachedResponse = {
          ...chatsCache.data,
          cached: true,
          cacheAge: cacheAge
        };
        
        res.json(cachedResponse);
        
        const responseDuration = Date.now() - requestStartTime;
        logger.info(`✅ ОТВЕТ ИЗ КЭША ОТПРАВЛЕН [ID: ${requestId}] за ${responseDuration}мс`);
        return;
      } else {
        logger.info(`⏰ Кэш устарел (возраст: ${(cacheAge / 1000).toFixed(1)} сек), требуется обновление`);
      }
    } else if (!force && chatsCache.data) {
      logger.info(`💾 Кэш существует, но требуется обновление`);
    } else if (force) {
      logger.info(`🔄 Принудительное обновление кэша`);
    } else {
      logger.info(`📋 Кэш пуст, загружаем чаты...`);
    }
    
    // Если уже идет обновление, ждем его завершения
    if (chatsCache.isUpdating && chatsCache.updatePromise) {
      logger.info(`⏳ Ожидание завершения текущего обновления кэша...`);
      try {
        const result = await chatsCache.updatePromise;
        logger.info(`✅ Используем результат текущего обновления`);
        const cachedResponse = {
          ...result,
          cached: false,
          cacheAge: 0
        };
        res.json(cachedResponse);
        return;
      } catch (updateError) {
        logger.error(`❌ Ошибка при ожидании обновления: ${updateError.message}`);
        // Продолжаем с новым запросом
      }
    }
    
    // Запускаем обновление кэша
    chatsCache.isUpdating = true;
    chatsCache.updatePromise = fetchAndProcessChats(force);
    
    const result = await chatsCache.updatePromise;
    
    const responseData = {
      ...result,
      cached: false,
      cacheAge: 0
    };
    
    res.json(responseData);
    
    const finalDuration = Date.now() - requestStartTime;
    logger.info(`✅ ОТВЕТ ОТПРАВЛЕН КЛИЕНТУ [ID: ${requestId}] за ${finalDuration}мс`);
  } catch (error) {
    const errorDuration = Date.now() - requestStartTime;
    logger.error('═'.repeat(80));
    logger.error(`❌ КРИТИЧЕСКАЯ ОШИБКА ПОЛУЧЕНИЯ СПИСКА ЧАТОВ [ID: ${requestId}]`);
    logger.error('═'.repeat(80));
    logger.error(`⏰ Время ошибки: ${new Date().toISOString()}`);
    logger.error(`⏱️ Время до ошибки: ${errorDuration}мс`);
    logger.error(`❌ Ошибка: ${error.message}`);
    logger.error(`📋 Тип ошибки: ${error.name}`);
    if (error.stack) {
      logger.error(`📋 Stack trace: ${error.stack}`);
    }
    logger.error('═'.repeat(80));
    
    // Отправляем ответ с ошибкой
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.message,
        errorType: error.name,
        groups: [],
        personalChats: [],
        cached: false
      });
    }
  }
});

/**
 * Получить список заданий
 * GET /api/tasks
 */
app.get('/api/tasks', async (req, res) => {
  try {
    const { getAllTasks } = await import('./tasks-manager.js');
    const tasks = getAllTasks();
    res.json({ tasks });
  } catch (error) {
    logger.error(`Ошибка получения заданий: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Создать задание
 * POST /api/tasks
 * Body: { name, promptId, chatIds: [] }
 */
app.post('/api/tasks', async (req, res) => {
  try {
    const { createTask } = await import('./tasks-manager.js');
    const { name, promptId, chatIds } = req.body;
    
    if (!promptId) {
      return res.status(400).json({ error: 'Необходимо указать promptId' });
    }
    
    if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ error: 'Необходимо выбрать хотя бы одну группу' });
    }
    
    const task = createTask(name, promptId, chatIds);
    res.json({ success: true, task });
  } catch (error) {
    logger.error(`Ошибка создания задания: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Обновить задание
 * PUT /api/tasks/:id
 */
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { updateTask } = await import('./tasks-manager.js');
    const taskId = parseInt(req.params.id);
    const updates = req.body;
    
    const task = updateTask(taskId, updates);
    res.json({ success: true, task });
  } catch (error) {
    logger.error(`Ошибка обновления задания: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Удалить задание
 * DELETE /api/tasks/:id
 */
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { deleteTask } = await import('./tasks-manager.js');
    const taskId = parseInt(req.params.id);
    
    deleteTask(taskId);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Ошибка удаления задания: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить список промптов из Ollama Service
 * GET /api/prompts
 */
app.get('/api/prompts', async (req, res) => {
  try {
    logger.info('📥 Запрос /api/prompts');
    const ollamaServiceUrl = process.env.OLLAMA_SERVICE_URL || 'http://localhost:4000';
    const axios = (await import('axios')).default;
    
    logger.info(`🔗 Подключение к Ollama Service: ${ollamaServiceUrl}/api/prompts`);
    
    const response = await axios.get(`${ollamaServiceUrl}/api/prompts`, {
      timeout: 5000,
      validateStatus: (status) => status < 500 // Не выбрасывать ошибку для 4xx
    });
    
    if (response.status === 404) {
      logger.warn(`⚠️ Ollama Service не найден (404): ${ollamaServiceUrl}/api/prompts`);
      return res.json([]); // Возвращаем пустой массив вместо ошибки
    }
    
    const prompts = Array.isArray(response.data) ? response.data : [];
    logger.info(`✅ Получено промптов: ${prompts.length}`);
    res.json(prompts);
  } catch (error) {
    logger.error(`❌ Ошибка получения промптов: ${error.message}`);
    // Возвращаем пустой массив вместо ошибки, чтобы не блокировать загрузку страницы
    res.json([]);
  }
});

/**
 * Получить конфигурацию мониторинга
 */
app.get('/api/config', (req, res) => {
  res.json(getMonitoringConfig());
});

/**
 * Обновить конфигурацию API
 */
app.post('/api/config/api', (req, res) => {
  try {
    updateApiConfig(req.body);
    res.json({ success: true, message: 'Конфигурация API обновлена' });
  } catch (error) {
    logger.error(`Ошибка обновления конфигурации API: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Обновить конфигурацию групп
 */
app.post('/api/config/groups', (req, res) => {
  try {
    updateMonitoredGroups(req.body);
    res.json({ success: true, message: 'Конфигурация групп обновлена' });
  } catch (error) {
    logger.error(`Ошибка обновления конфигурации групп: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Обновить конфигурацию личных чатов
 */
app.post('/api/config/personal', (req, res) => {
  try {
    updateMonitoredPersonalChats(req.body);
    res.json({ success: true, message: 'Конфигурация личных чатов обновлена' });
  } catch (error) {
    logger.error(`Ошибка обновления конфигурации личных чатов: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Обновить настройки логирования
 */
app.post('/api/config/logging', (req, res) => {
  try {
    updateLoggingConfig(req.body);
    res.json({ success: true, message: 'Настройки логирования обновлены' });
  } catch (error) {
    logger.error(`Ошибка обновления настроек логирования: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Отправить тестовое сообщение
 */
app.post('/api/test-message', async (req, res) => {
  try {
    logger.info('📥 Получен запрос на тестовое сообщение');
    logger.info(`📦 Заголовки запроса:`, JSON.stringify(req.headers, null, 2));
    logger.info(`📦 Тип контента: ${req.headers['content-type']}`);
    logger.info(`📦 Тело запроса (req.body):`, JSON.stringify(req.body, null, 2));
    logger.info(`📦 Тип req.body: ${typeof req.body}`);
    logger.info(`📦 req.body пустой?: ${!req.body || Object.keys(req.body).length === 0}`);
    
    // Проверяем, что тело запроса существует
    if (!req.body || typeof req.body !== 'object') {
      logger.error(`❌ req.body пустой или не является объектом!`);
      logger.error(`   req.body =`, req.body);
      return res.status(400).json({ error: 'Тело запроса пустое или неверный формат' });
    }
    
    const { content, chatId, chatName, senderName, senderPhone, isGroup, promptId } = req.body;
    
    logger.info(`📝 Распарсенные данные:`);
    logger.info(`   - content: "${content}" (тип: ${typeof content}, длина: ${content ? content.length : 0})`);
    logger.info(`   - chatId: "${chatId}"`);
    logger.info(`   - chatName: "${chatName}"`);
    logger.info(`   - senderName: "${senderName}"`);
    logger.info(`   - senderPhone: "${senderPhone}"`);
    logger.info(`   - isGroup: ${isGroup}`);
    logger.info(`   - promptId: ${promptId}`);
    
    // Проверяем content более строго
    const contentValue = content;
    const isEmpty = !contentValue || 
                    (typeof contentValue === 'string' && contentValue.trim().length === 0) ||
                    contentValue === null ||
                    contentValue === undefined;
    
    if (isEmpty) {
      logger.warn(`⚠️  Пустой контент!`);
      logger.warn(`   content =`, contentValue);
      logger.warn(`   req.body =`, JSON.stringify(req.body, null, 2));
      return res.status(400).json({ error: 'Сообщение не указано' });
    }
    
    // Проверяем chatId
    if (!chatId) {
      logger.warn(`⚠️  Не указан chatId!`);
      return res.status(400).json({ error: 'Необходимо указать chatId группы' });
    }
    
    // Формируем объект сообщения для обработчика
    const testMessage = {
      content: content,
      chatId: chatId, // ID выбранной группы
      chatName: chatName || 'Test Group',
      senderName: senderName || 'Test User',
      senderPhone: senderPhone || '79999999999',
      isGroup: isGroup !== false, // По умолчанию true
      promptId: promptId ? parseInt(promptId) : null
    };
    
    logger.info(`📤 Отправка тестового сообщения в обработчик:`);
    logger.info(`   Chat ID: ${testMessage.chatId}`);
    logger.info(`   Chat Name: ${testMessage.chatName}`);
    logger.info(`   Content: ${testMessage.content.substring(0, 100)}...`);
    
    const { handleTestMessage } = await import('./message-handler.js');
    await handleTestMessage(testMessage);
    
    res.json({ success: true, message: 'Тестовое сообщение обработано' });
  } catch (error) {
    logger.error(`Ошибка обработки тестового сообщения: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить логи
 */
app.get('/api/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100');
    const logs = getLogs(limit);
    res.json({ logs });
  } catch (error) {
    logger.error(`Ошибка получения логов: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Очистить логи
 */
app.post('/api/logs/clear', (req, res) => {
  try {
    clearLogs();
    res.json({ success: true, message: 'Логи очищены' });
  } catch (error) {
    logger.error(`Ошибка очистки логов: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Восстановить контакты из WhatsApp API
 * POST /api/restore-contacts
 * Body: { type: 'sellers' | 'offers' | 'all', limit?: number }
 */
app.post('/api/restore-contacts', async (req, res) => {
  try {
    const client = getClient();
    if (!client || !client.info || !client.info.wid) {
      return res.status(503).json({ 
        error: 'WhatsApp клиент не готов. Дождитесь подключения.' 
      });
    }

    const { startRestore } = await import('./restore-contacts-service.js');
    const { type = 'all' } = req.body;

    logger.info(`🔄 Запуск восстановления контактов: type=${type}`);

    // Запускаем восстановление асинхронно
    startRestore(type).then(results => {
      logger.info('✅ Восстановление завершено');
    }).catch(error => {
      logger.error(`❌ Ошибка восстановления: ${error.message}`);
    });

    res.json({ 
      success: true, 
      message: 'Восстановление запущено',
      status: 'running'
    });
  } catch (error) {
    logger.error(`Ошибка запуска восстановления контактов: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить логи восстановления
 * GET /api/restore-contacts/logs
 */
app.get('/api/restore-contacts/logs', async (req, res) => {
  try {
    const { getRestoreLogs } = await import('./restore-contacts-service.js');
    const logs = getRestoreLogs();
    res.json({ logs });
  } catch (error) {
    logger.error(`Ошибка получения логов восстановления: ${error.message}`);
    res.json({ logs: [] });
  }
});

/**
 * Очистить логи восстановления
 * POST /api/restore-contacts/logs/clear
 */
app.post('/api/restore-contacts/logs/clear', async (req, res) => {
  try {
    const { clearRestoreLogs } = await import('./restore-contacts-service.js');
    clearRestoreLogs();
    res.json({ success: true, message: 'Логи очищены' });
  } catch (error) {
    logger.error(`Ошибка очистки логов: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить список предложений для восстановления
 * GET /api/restore-contacts/offers?limit=1000
 */
app.get('/api/restore-contacts/offers', async (req, res) => {
  try {
    const { getOffersToRestore } = await import('./restore-contacts-service.js');
    const limit = parseInt(req.query.limit || '1000');
    const offers = await getOffersToRestore(limit);
    res.json({ offers, count: offers.length });
  } catch (error) {
    logger.error(`Ошибка получения списка предложений: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Тестирование методов получения номера телефона из WhatsApp ID
 * GET /api/restore-contacts/test-methods?whatsappId=120363046456598557 (опционально)
 * POST /api/restore-contacts/test-methods
 * Body: { whatsappId: "120363046456598557" } (опционально, если не указан - берется первый из БД)
 */
app.get('/api/restore-contacts/test-methods', async (req, res) => {
  try {
    const client = getClient();
    if (!client || !client.info || !client.info.wid) {
      return res.status(503).json({ 
        error: 'WhatsApp клиент не готов. Дождитесь подключения.' 
      });
    }

    const { testContactRetrievalMethods } = await import('./restore-contacts-service.js');
    const whatsappId = req.query.whatsappId || null;
    
    const result = await testContactRetrievalMethods(whatsappId);
    res.json(result);
  } catch (error) {
    logger.error(`Ошибка тестирования методов: ${error.message}`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/restore-contacts/test-methods', async (req, res) => {
  try {
    const client = getClient();
    if (!client || !client.info || !client.info.wid) {
      return res.status(503).json({ 
        error: 'WhatsApp клиент не готов. Дождитесь подключения.' 
      });
    }

    const { testContactRetrievalMethods } = await import('./restore-contacts-service.js');
    const { whatsappId } = req.body;
    
    const result = await testContactRetrievalMethods(whatsappId);
    res.json(result);
  } catch (error) {
    logger.error(`Ошибка тестирования методов: ${error.message}`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Восстановить одно предложение по ID
 * POST /api/restore-contacts/offers/:id
 */
app.post('/api/restore-contacts/offers/:id', async (req, res) => {
  try {
    const client = getClient();
    if (!client || !client.info || !client.info.wid) {
      return res.status(503).json({ 
        error: 'WhatsApp клиент не готов. Дождитесь подключения.' 
      });
    }

    const offerId = parseInt(req.params.id);
    if (!offerId || isNaN(offerId)) {
      return res.status(400).json({ error: 'Неверный ID предложения' });
    }

    const { restoreSingleOffer } = await import('./restore-contacts-service.js');
    const result = await restoreSingleOffer(offerId);
    
    res.json({ 
      success: true, 
      message: 'Предложение восстановлено',
      result 
    });
  } catch (error) {
    logger.error(`Ошибка восстановления предложения: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить количество товаров
 */
app.get('/api/products', (req, res) => {
  try {
    const products = getProducts();
    const currentCount = products.length;
    
    // Логируем только если количество изменилось
    if (currentCount !== lastProductCount) {
      logger.info(`📦 API /api/products: запрошено ${currentCount} товаров`);
      lastProductCount = currentCount;
    }
    
    res.json({ products, count: currentCount });
  } catch (error) {
    logger.error(`Ошибка получения товаров: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Очистить буфер товаров
 */
app.post('/api/products/clear', (req, res) => {
  try {
    clearProducts();
    lastProductCount = 0;
    res.json({ success: true, message: 'Буфер товаров очищен' });
  } catch (error) {
    logger.error(`Ошибка очистки буфера товаров: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для тестирования WhatsApp
 * POST /api/test/send-message - Отправить сообщение в WhatsApp
 */
app.post('/api/test/send-message', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    const { chatId, message } = req.body;
    
    if (!chatId) {
      return res.status(400).json({ error: 'Необходимо указать chatId' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Необходимо указать message' });
    }
    
    logger.info(`📤 Тестовая отправка сообщения в WhatsApp:`);
    logger.info(`   Chat ID: ${chatId}`);
    logger.info(`   Message: ${message.substring(0, 100)}...`);
    
    try {
      const result = await client.sendMessage(chatId, message);
      
      logger.info(`✅ Сообщение отправлено успешно`);
      logger.info(`   Message ID: ${result.id._serialized}`);
      
      res.json({
        success: true,
        messageId: result.id._serialized,
        timestamp: result.timestamp,
        from: result.from,
        to: result.to,
        body: result.body,
        raw: {
          id: result.id,
          timestamp: result.timestamp,
          from: result.from,
          to: result.to,
          body: result.body,
          hasMedia: result.hasMedia,
          type: result.type
        }
      });
    } catch (error) {
      logger.error(`❌ Ошибка отправки сообщения: ${error.message}`);
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на отправку сообщения: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для тестирования WhatsApp
 * GET /api/test/contacts - Получить список контактов
 */
app.get('/api/test/contacts', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    logger.info(`📋 Получение списка контактов...`);
    
    try {
      const contacts = await client.getContacts();
      
      const contactsData = contacts.map(contact => ({
        id: contact.id?._serialized || contact.id?.user || 'unknown',
        userId: contact.id?.user || 'unknown',
        number: contact.number || contact.id?.user || 'unknown',
        name: contact.name || contact.pushname || contact.number || 'Unknown',
        pushname: contact.pushname || null,
        isUser: contact.isUser || false,
        isMyContact: contact.isMyContact || false,
        isGroup: contact.isGroup || false,
        isBusiness: contact.isBusiness || false
      }));
      
      logger.info(`✅ Получено контактов: ${contactsData.length}`);
      
      res.json({
        success: true,
        contacts: contactsData,
        count: contactsData.length
      });
    } catch (error) {
      logger.error(`❌ Ошибка получения контактов: ${error.message}`);
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на получение контактов: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для тестирования WhatsApp
 * GET /api/test/client-info - Получить информацию о клиенте
 */
app.get('/api/test/client-info', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    logger.info(`📋 Получение информации о клиенте...`);
    
    try {
      const info = client.info;
      const state = await client.getState();
      
      const clientInfo = {
        pushname: info.pushname || null,
        wid: {
          user: info.wid?.user || null,
          server: info.wid?.server || null,
          _serialized: info.wid?._serialized || null
        },
        platform: info.platform || null,
        state: state,
        status: status.status,
        isReady: status.isReady
      };
      
      logger.info(`✅ Информация о клиенте получена`);
      
      res.json({
        success: true,
        clientInfo: clientInfo
      });
    } catch (error) {
      logger.error(`❌ Ошибка получения информации о клиенте: ${error.message}`);
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на получение информации о клиенте: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для тестирования WhatsApp
 * GET /api/test/chat/:chatId - Получить информацию о чате
 */
app.get('/api/test/chat/:chatId', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    const chatId = req.params.chatId;
    logger.info(`📋 Получение информации о чате: ${chatId}`);
    
    try {
      const chat = await client.getChatById(chatId);
      
      const chatInfo = {
        id: chat.id?._serialized || chat.id?.user || 'unknown',
        name: chat.name || 'Unknown',
        isGroup: chat.isGroup || false,
        isReadOnly: chat.isReadOnly || false,
        unreadCount: chat.unreadCount || 0,
        timestamp: chat.timestamp || null,
        archived: chat.archived || false,
        pinned: chat.pinned || false,
        muted: chat.muted || null
      };
      
      // Если это группа, получаем участников
      if (chat.isGroup) {
        try {
          const participants = await chat.participants;
          chatInfo.participants = participants.map(p => ({
            id: p.id?._serialized || p.id?.user || 'unknown',
            userId: p.id?.user || 'unknown',
            number: p.number || p.id?.user || 'unknown',
            name: p.name || p.pushname || p.number || 'Unknown',
            pushname: p.pushname || null,
            isAdmin: p.isAdmin || false,
            isSuperAdmin: p.isSuperAdmin || false
          }));
          chatInfo.participantCount = chatInfo.participants.length;
        } catch (participantsError) {
          logger.warn(`⚠️  Ошибка получения участников: ${participantsError.message}`);
          chatInfo.participants = [];
          chatInfo.participantError = participantsError.message;
        }
      }
      
      logger.info(`✅ Информация о чате получена`);
      
      res.json({
        success: true,
        chat: chatInfo
      });
    } catch (error) {
      logger.error(`❌ Ошибка получения информации о чате: ${error.message}`);
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на получение информации о чате: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для тестирования WhatsApp
 * GET /api/test/chat/:chatId/messages - Получить последние сообщения из чата
 */
app.get('/api/test/chat/:chatId/messages', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    const chatId = req.params.chatId;
    const limit = parseInt(req.query.limit || '3'); // По умолчанию 3 сообщения
    
    logger.info(`📋 Получение последних ${limit} сообщений из чата: ${chatId}`);
    
    try {
      const chat = await client.getChatById(chatId);
      
      // Получаем последние сообщения с обработкой ошибок и таймаутом
      let messages;
      try {
        // Добавляем таймаут для получения сообщений (30 секунд)
        const fetchPromise = chat.fetchMessages({ limit: limit });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout: получение сообщений превысило 30 секунд')), 30000)
        );
        
        messages = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (fetchError) {
        logger.error(`❌ Ошибка получения сообщений из чата: ${fetchError.message}`);
        if (fetchError.stack) {
          logger.error(`Stack trace: ${fetchError.stack}`);
        }
        throw new Error(`Не удалось получить сообщения: ${fetchError.message}`);
      }
      
      if (!Array.isArray(messages)) {
        logger.warn(`⚠️  fetchMessages вернул не массив: ${typeof messages}`);
        messages = [];
      }
      
      const messagesData = [];
      const seen = new WeakSet(); // Для отслеживания циклических ссылок
      
      // Обрабатываем сообщения последовательно с ограничением времени на каждое
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        try {
          const messageData = {
            id: msg.id?._serialized || msg.id?.user || 'unknown',
            timestamp: msg.timestamp || null,
            from: msg.from || null,
            to: msg.to || null,
            body: (msg.body || '').substring(0, 10000), // Ограничиваем длину текста
            type: msg.type || 'unknown',
            hasMedia: msg.hasMedia || false,
            isForwarded: msg.isForwarded || false,
            isStarred: msg.isStarred || false,
            fromMe: msg.fromMe || false
          };
          
          // Если есть медиа, добавляем информацию о медиа (без самих данных)
          if (msg.hasMedia) {
            try {
              messageData.mediaType = msg.type || null;
              messageData.mediaFilename = msg.filename || null;
              messageData.mediaMimetype = msg.mimetype || null;
              // НЕ включаем медиа данные, чтобы не перегружать ответ
            } catch (mediaError) {
              logger.warn(`⚠️  Ошибка получения информации о медиа: ${mediaError.message}`);
            }
          }
          
          // Если есть информация об отправителе, получаем её безопасно
          if (msg.from && msg.from !== 'status@broadcast') {
            try {
              // Используем await для асинхронного getContact() с таймаутом
              const contactPromise = msg.getContact();
              const contactTimeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout получения контакта')), 5000)
              );
              
              const contact = await Promise.race([contactPromise, contactTimeout]);
              
              if (contact && !seen.has(contact)) {
                seen.add(contact);
                messageData.sender = {
                  id: contact.id?._serialized || contact.id?.user || 'unknown',
                  name: (contact.name || contact.pushname || contact.number || 'Unknown').substring(0, 200),
                  pushname: (contact.pushname || null) ? contact.pushname.substring(0, 200) : null,
                  number: contact.number || null
                };
              }
            } catch (contactError) {
              // Если не удалось получить контакт, просто пропускаем эту информацию
              if (!contactError.message.includes('Timeout')) {
                logger.debug(`⚠️  Ошибка получения информации об отправителе: ${contactError.message}`);
              }
              // Используем базовую информацию из сообщения
              if (msg.from) {
                messageData.sender = {
                  id: msg.from,
                  name: 'Unknown',
                  pushname: null,
                  number: null
                };
              }
            }
          }
          
          messagesData.push(messageData);
        } catch (msgError) {
          logger.error(`❌ Ошибка обработки сообщения: ${msgError.message}`);
          // Добавляем сообщение об ошибке вместо полного сообщения
          messagesData.push({
            id: 'error',
            error: `Ошибка обработки сообщения: ${msgError.message}`,
            timestamp: null
          });
        }
      }
      
      logger.info(`✅ Получено сообщений: ${messagesData.length}`);
      
      // Безопасная сериализация с обработкой циклических ссылок
      const safeSerialize = (obj) => {
        const seen = new WeakSet();
        return JSON.stringify(obj, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular Reference]';
            }
            seen.add(value);
          }
          if (typeof value === 'function') {
            return '[Function]';
          }
          if (typeof value === 'undefined') {
            return '[Undefined]';
          }
          return value;
        }, 2);
      };
      
      try {
        const responseData = {
          success: true,
          chatId: chatId,
          chatName: chat.name || 'Unknown',
          messages: messagesData,
          count: messagesData.length,
          limit: limit
        };
        
        // Проверяем размер ответа
        const responseSize = JSON.stringify(responseData).length;
        if (responseSize > 10 * 1024 * 1024) { // Больше 10MB
          logger.warn(`⚠️  Размер ответа очень большой: ${(responseSize / 1024 / 1024).toFixed(2)}MB`);
          responseData.warning = 'Размер ответа очень большой, некоторые данные могут быть урезаны';
        }
        
        res.json(responseData);
      } catch (serializeError) {
        logger.error(`❌ Ошибка сериализации ответа: ${serializeError.message}`);
        res.status(500).json({
          success: false,
          error: `Ошибка сериализации данных: ${serializeError.message}`,
          errorType: serializeError.name
        });
      }
    } catch (error) {
      logger.error(`❌ Ошибка получения сообщений: ${error.message}`);
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на получение сообщений: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для тестирования WhatsApp
 * GET /api/test/message/:messageId/author-phone - Получить номер телефона автора сообщения
 */
app.get('/api/test/message/:messageId/author-phone', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    const messageId = req.params.messageId;
    logger.info(`📋 Получение номера телефона автора сообщения: ${messageId}`);
    
    try {
      // Получаем сообщение по ID
      // Формат ID может быть разным: "true_120363123456789@g.us_3EB0..." или просто ID
      let message;
      try {
        // Пробуем получить сообщение через поиск по всем чатам
        // Это может быть медленно, но это единственный способ получить сообщение по ID
        const chats = await client.getChats();
        
        message = null;
        for (const chat of chats) {
          try {
            const messages = await chat.fetchMessages({ limit: 100 });
            const foundMessage = messages.find(msg => 
              msg.id?._serialized === messageId || 
              msg.id?.user === messageId ||
              (msg.id?._serialized && msg.id._serialized.includes(messageId)) ||
              (msg.id?.user && msg.id.user.includes(messageId))
            );
            
            if (foundMessage) {
              message = foundMessage;
              break;
            }
          } catch (chatError) {
            // Пропускаем чаты, где не удалось получить сообщения
            continue;
          }
        }
        
        if (!message) {
          throw new Error('Сообщение не найдено');
        }
      } catch (searchError) {
        logger.error(`❌ Ошибка поиска сообщения: ${searchError.message}`);
        throw new Error(`Не удалось найти сообщение: ${searchError.message}`);
      }
      
      // Определяем chatId автора сообщения
      // Если есть msg.id.participant (групповое сообщение), используем msg.author
      // Иначе используем msg.from (личное сообщение)
      let authorChatId;
      if (message.id?.participant) {
        authorChatId = message.author || message.from;
        logger.info(`📋 Групповое сообщение, используем author: ${authorChatId}`);
      } else {
        authorChatId = message.from;
        logger.info(`📋 Личное сообщение, используем from: ${authorChatId}`);
      }
      
      if (!authorChatId) {
        throw new Error('Не удалось определить ID автора сообщения');
      }
      
      // Получаем чат по ID автора
      let authorChat;
      try {
        authorChat = await client.getChatById(authorChatId);
      } catch (chatError) {
        logger.error(`❌ Ошибка получения чата автора: ${chatError.message}`);
        throw new Error(`Не удалось получить чат автора: ${chatError.message}`);
      }
      
      // Извлекаем номер телефона из chat.id.user
      const authorPhone = authorChat.id?.user || null;
      
      if (!authorPhone) {
        throw new Error('Не удалось извлечь номер телефона из чата автора');
      }
      
      logger.info(`✅ Номер телефона автора получен: ${authorPhone}`);
      
      // Получаем имя автора через контакт
      let authorName = null;
      let authorPushname = null;
      try {
        const authorContact = await client.getContactById(authorChatId);
        if (authorContact) {
          authorName = authorContact.name || null;
          authorPushname = authorContact.pushname || null;
          logger.info(`✅ Имя автора получено: ${authorName || authorPushname || 'N/A'}`);
        }
      } catch (contactError) {
        logger.warn(`⚠️  Не удалось получить контакт для имени: ${contactError.message}`);
        // Пробуем альтернативный способ - из чата
        try {
          authorName = authorChat.name || null;
          logger.info(`✅ Имя из чата: ${authorName || 'N/A'}`);
        } catch (chatNameError) {
          logger.debug(`⚠️  Не удалось получить имя из чата: ${chatNameError.message}`);
        }
      }
      
      res.json({
        success: true,
        messageId: messageId,
        authorChatId: authorChatId,
        authorPhone: authorPhone,
        authorName: authorName || authorPushname || null,
        authorPushname: authorPushname || null,
        isGroup: message.id?.participant ? true : false,
        messageInfo: {
          id: message.id?._serialized || message.id?.user || 'unknown',
          from: message.from || null,
          author: message.author || null,
          hasParticipant: !!message.id?.participant
        }
      });
    } catch (error) {
      logger.error(`❌ Ошибка получения номера телефона автора: ${error.message}`);
      if (error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
      }
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на получение номера телефона автора: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API для обработки последних сообщений из чата
 * POST /api/chat/:chatId/process-messages?limit=N
 */
app.post('/api/chat/:chatId/process-messages', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client) {
      return res.status(503).json({ error: 'WhatsApp клиент не инициализирован' });
    }
    
    const status = getClientStatus();
    if (!status.isReady) {
      return res.status(503).json({ error: `WhatsApp клиент не готов (статус: ${status.status})` });
    }
    
    const chatId = req.params.chatId;
    const limit = parseInt(req.query.limit || '3');
    
    logger.info(`📋 Обработка последних ${limit} сообщений из чата: ${chatId}`);
    
    try {
      const chat = await client.getChatById(chatId);
      
      // Получаем последние сообщения
      let messages;
      try {
        const fetchPromise = chat.fetchMessages({ limit: limit });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout: получение сообщений превысило 30 секунд')), 30000)
        );
        
        messages = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (fetchError) {
        logger.error(`❌ Ошибка получения сообщений из чата: ${fetchError.message}`);
        throw new Error(`Не удалось получить сообщения: ${fetchError.message}`);
      }
      
      if (!Array.isArray(messages)) {
        logger.warn(`⚠️  fetchMessages вернул не массив: ${typeof messages}`);
        messages = [];
      }
      
      // Логируем полученные сообщения
      logger.info('═'.repeat(80));
      logger.info(`📨 ПОЛУЧЕНО СООБЩЕНИЙ ИЗ ГРУППЫ: ${messages.length}`);
      logger.info('═'.repeat(80));
      logger.info(`📱 Группа: ${chat.name || 'Unknown'} (${chatId})`);
      logger.info(`📊 Количество: ${messages.length} сообщений`);
      logger.info('');
      
      // Извлекаем и логируем информацию о сообщениях и номерах телефонов
      const messagesInfo = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        try {
          const msgId = msg.id?._serialized || msg.id?.user || 'unknown';
          const msgBody = msg.body ? (msg.body.substring(0, 100) + (msg.body.length > 100 ? '...' : '')) : '(без текста)';
          const msgFrom = msg.from || 'unknown';
          const msgAuthor = msg.author || null;
          
          // Определяем chatId автора для получения номера телефона
          let authorChatId = null;
          let authorPhone = null;
          
          try {
            if (msg.id?.participant) {
              authorChatId = msg.author || msg.from;
            } else {
              authorChatId = msg.from;
            }
            
            if (authorChatId) {
              const authorChat = await client.getChatById(authorChatId);
              authorPhone = authorChat?.id?.user || null;
            }
          } catch (phoneError) {
            logger.debug(`⚠️  Не удалось получить номер для сообщения ${i + 1}: ${phoneError.message}`);
          }
          
          const messageInfo = {
            index: i + 1,
            id: msgId,
            body: msgBody,
            from: msgFrom,
            author: msgAuthor,
            phone: authorPhone,
            timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null
          };
          
          messagesInfo.push(messageInfo);
          
          logger.info(`📨 Сообщение ${i + 1}/${messages.length}:`);
          logger.info(`   ID: ${msgId}`);
          logger.info(`   Текст: ${msgBody}`);
          logger.info(`   От: ${msgFrom}`);
          if (msgAuthor && msgAuthor !== msgFrom) {
            logger.info(`   Автор: ${msgAuthor}`);
          }
          if (authorPhone) {
            logger.info(`   📞 Номер телефона: ${authorPhone}`);
          } else {
            logger.info(`   📞 Номер телефона: не получен`);
          }
          if (messageInfo.timestamp) {
            logger.info(`   ⏰ Время: ${messageInfo.timestamp}`);
          }
          logger.info('');
        } catch (infoError) {
          logger.warn(`⚠️  Ошибка извлечения информации о сообщении ${i + 1}: ${infoError.message}`);
        }
      }
      
      logger.info('═'.repeat(80));
      logger.info(`📊 СВОДКА ПОЛУЧЕННЫХ СООБЩЕНИЙ:`);
      logger.info(`   Всего сообщений: ${messages.length}`);
      logger.info(`   С номерами телефонов: ${messagesInfo.filter(m => m.phone).length}`);
      logger.info(`   Без номеров телефонов: ${messagesInfo.filter(m => !m.phone).length}`);
      logger.info('');
      logger.info(`📞 ПОЛУЧЕННЫЕ НОМЕРА ТЕЛЕФОНОВ:`);
      const uniquePhones = [...new Set(messagesInfo.filter(m => m.phone).map(m => m.phone))];
      uniquePhones.forEach((phone, idx) => {
        const count = messagesInfo.filter(m => m.phone === phone).length;
        logger.info(`   ${idx + 1}. ${phone} (${count} сообщений)`);
      });
      if (uniquePhones.length === 0) {
        logger.info(`   (номера телефонов не получены)`);
      }
      logger.info('═'.repeat(80));
      logger.info('');
      
      // Импортируем handleMessage для обработки
      const { handleMessage } = await import('./message-handler.js');
      
      // Обрабатываем сообщения последовательно
      const results = {
        processed: messages.length,
        successCount: 0,
        errorCount: 0,
        errors: [],
        messagesInfo: messagesInfo
      };
      
      logger.info(`🔄 Начинаем обработку ${messages.length} сообщений...`);
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        try {
          logger.info(`📨 Обработка сообщения ${i + 1}/${messages.length}...`);
          await handleMessage(msg);
          results.successCount++;
          logger.info(`✅ Сообщение ${i + 1} обработано успешно`);
        } catch (msgError) {
          results.errorCount++;
          const errorMsg = `Сообщение ${i + 1}: ${msgError.message}`;
          results.errors.push(errorMsg);
          logger.error(`❌ Ошибка обработки сообщения ${i + 1}: ${msgError.message}`);
        }
      }
      
      logger.info(`✅ Обработка завершена: ${results.successCount} успешно, ${results.errorCount} ошибок`);
      
      res.json({
        success: true,
        chatId: chatId,
        chatName: chat.name || 'Unknown',
        limit: limit,
        ...results
      });
    } catch (error) {
      logger.error(`❌ Ошибка обработки сообщений: ${error.message}`);
      if (error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
      }
      res.status(500).json({ 
        success: false,
        error: error.message,
        errorType: error.name
      });
    }
  } catch (error) {
    logger.error(`Ошибка обработки запроса на обработку сообщений: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Webhook для получения результатов от Ollama Service
 */
app.post('/api/webhook/ollama-result', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  try {
    logger.info('═'.repeat(80));
    logger.info(`📥 ПОЛУЧЕН CALLBACK ОТ OLLAMA [ID: ${requestId}]`);
    logger.info('═'.repeat(80));
    logger.info(`⏰ Время: ${new Date().toISOString()}`);
    logger.info(`📋 Headers:`, JSON.stringify(req.headers, null, 2));
    logger.info(`📋 Body:`, JSON.stringify(req.body, null, 2));
    logger.info('═'.repeat(80));
    logger.info('');
    
    const { whatsapp_message_id, task_id, parsed_data, status, error: parsingError } = req.body;
    
    logger.info('📋 РАСПАРСЕННЫЕ ДАННЫЕ ИЗ CALLBACK:');
    logger.info(`   whatsapp_message_id: ${whatsapp_message_id || '❌ отсутствует'}`);
    logger.info(`   task_id: ${task_id || 'N/A'}`);
    logger.info(`   status: ${status || 'N/A'}`);
    logger.info(`   parsed_data: ${parsed_data ? '✅ есть' : '❌ null/отсутствует'}`);
    logger.info(`   error: ${parsingError || 'N/A'}`);
    logger.info('');
    
    if (!whatsapp_message_id) {
      logger.error('❌ ОШИБКА: whatsapp_message_id обязателен');
      return res.status(400).json({ error: 'whatsapp_message_id обязателен' });
    }
    
    // Детальное логирование parsed_data
    if (parsed_data) {
      logger.info('═'.repeat(80));
      logger.info('📊 ДЕТАЛЬНЫЙ АНАЛИЗ PARSED_DATA');
      logger.info('═'.repeat(80));
      logger.info(`   Тип: ${typeof parsed_data}`);
      logger.info(`   Является объектом: ${typeof parsed_data === 'object' && parsed_data !== null}`);
      logger.info(`   Полная структура:`, JSON.stringify(parsed_data, null, 2));
      
      if (typeof parsed_data === 'object' && parsed_data !== null) {
        logger.info(`   Ключи объекта: ${Object.keys(parsed_data).join(', ')}`);
        logger.info(`   isMiningEquipment: ${parsed_data.isMiningEquipment}`);
        logger.info(`   operationType: ${parsed_data.operationType || 'N/A'}`);
        logger.info(`   location: ${parsed_data.location || 'N/A'}`);
        logger.info(`   products: ${parsed_data.products ? (Array.isArray(parsed_data.products) ? `✅ массив (${parsed_data.products.length} элементов)` : `⚠️ не массив (${typeof parsed_data.products})`) : '❌ отсутствует'}`);
        
        if (parsed_data.products && Array.isArray(parsed_data.products)) {
          logger.info(`   Количество товаров: ${parsed_data.products.length}`);
          parsed_data.products.forEach((product, index) => {
            logger.info(`   Товар ${index + 1}:`, JSON.stringify(product, null, 2));
          });
        }
      }
      logger.info('═'.repeat(80));
      logger.info('');
    } else {
      logger.warn('⚠️  PARSED_DATA ОТСУТСТВУЕТ ИЛИ NULL');
      logger.warn('   Это означает, что Ollama не вернул данные или парсинг не удался');
      logger.warn('');
    }
    
    // Обновляем статус сообщения в базе данных
    if (parsingError || status === 'failed') {
      logger.info('📋 ОБРАБОТКА ОШИБКИ ПАРСИНГА...');
      await messageRepository.updateMessageStatus(whatsapp_message_id, 'ollama_error', {
        error: parsingError || 'Unknown error'
      });
      logger.warn(`⚠️  Ошибка парсинга для сообщения #${whatsapp_message_id}: ${parsingError || 'Unknown error'}`);
    } else {
      logger.info('📋 СОХРАНЕНИЕ ДАННЫХ ПАРСИНГА...');
      
      // Сохраняем данные парсинга (даже если parsed_data = null)
      await messageRepository.updateMessageParsedData(whatsapp_message_id, parsed_data);
      logger.info(`✅ Данные парсинга для сообщения #${whatsapp_message_id} сохранены в БД`);
      
      // Получаем исходное сообщение из БД для формирования данных для Spring Boot
      logger.info('📋 ПОЛУЧЕНИЕ ИСХОДНОГО СООБЩЕНИЯ ИЗ БД...');
      let originalMessage = null;
      try {
        originalMessage = await messageRepository.getMessageByWhatsAppId(whatsapp_message_id);
        if (originalMessage) {
          logger.info(`✅ Исходное сообщение найдено в БД:`);
          logger.info(`   Chat ID: ${originalMessage.chat_id}`);
          logger.info(`   Chat Name: ${originalMessage.chat_name}`);
          logger.info(`   Sender ID: ${originalMessage.sender_id}`);
          logger.info(`   Sender Name: ${originalMessage.sender_name}`);
          logger.info(`   Sender Phone: ${originalMessage.sender_phone_number}`);
          logger.info(`   Content: ${originalMessage.content ? `${originalMessage.content.length} символов` : 'пусто'}`);
        } else {
          logger.warn(`⚠️  Исходное сообщение не найдено в БД для whatsapp_message_id: ${whatsapp_message_id}`);
        }
      } catch (dbError) {
        logger.error(`❌ Ошибка получения исходного сообщения из БД: ${dbError.message}`);
      }
      
      // Обрабатываем товары из parsed_data
      if (parsed_data && typeof parsed_data === 'object' && parsed_data !== null) {
        logger.info('📋 ОБРАБОТКА ТОВАРОВ ИЗ PARSED_DATA...');
        
        // Проверяем структуру данных - может быть products (массив) или product (один товар)
        let productsToProcess = [];
        
        if (parsed_data.products && Array.isArray(parsed_data.products)) {
          // Новая структура с массивом products
          productsToProcess = parsed_data.products;
          logger.info(`   Найдено товаров в массиве products: ${productsToProcess.length}`);
        } else if (parsed_data.product) {
          // Старая структура с одним product
          productsToProcess = [parsed_data.product];
          logger.info(`   Найден один товар в поле product`);
        } else if (parsed_data.isMiningEquipment && parsed_data.products === undefined) {
          // Нет товаров, но это оборудование
          logger.info(`   isMiningEquipment=true, но товары отсутствуют`);
        }
        
        logger.info(`   Всего товаров для обработки: ${productsToProcess.length}`);
        
        // Обрабатываем каждый товар
        if (productsToProcess.length > 0) {
          for (let i = 0; i < productsToProcess.length; i++) {
            const product = productsToProcess[i];
            logger.info(`   Обработка товара ${i + 1}/${productsToProcess.length}:`, JSON.stringify(product, null, 2));
            
            // Формируем данные для отправки в Spring Boot
            // Используем данные из БД, если они есть, иначе из parsed_data
            const messageData = {
              messageId: originalMessage ? `whatsapp_${originalMessage.id}_${i}` : `whatsapp_${whatsapp_message_id}_${i}`,
              chatId: originalMessage?.chat_id || parsed_data.chatId || 'unknown',
              chatName: originalMessage?.chat_name || parsed_data.chatName || 'Unknown',
              senderId: originalMessage?.sender_id || parsed_data.senderId || 'unknown',
              senderName: originalMessage?.sender_name || parsed_data.senderName || 'Unknown',
              senderPhoneNumber: originalMessage?.sender_phone_number || parsed_data.senderPhoneNumber || 'unknown',
              content: originalMessage?.content || parsed_data.originalMessage || '',
              timestamp: originalMessage?.timestamp ? new Date(originalMessage.timestamp).toISOString() : new Date().toISOString(),
              hasMedia: originalMessage?.has_media || false,
              messageType: originalMessage?.message_type || 'chat',
              isForwarded: originalMessage?.is_forwarded || false,
              parsedData: {
                isMiningEquipment: parsed_data.isMiningEquipment || false,
                operationType: parsed_data.operationType || product.operationType || null,
                location: parsed_data.location || product.location || '',
                products: [product] // Отправляем один товар за раз
              }
            };
            
            logger.info('═'.repeat(80));
            logger.info(`📤 ДАННЫЕ ДЛЯ ОТПРАВКИ В SPRING BOOT (товар ${i + 1}):`);
            logger.info('═'.repeat(80));
            logger.info(`   messageId: ${messageData.messageId}`);
            logger.info(`   chatId: ${messageData.chatId}`);
            logger.info(`   chatName: ${messageData.chatName}`);
            logger.info(`   senderId: ${messageData.senderId}`);
            logger.info(`   senderName: ${messageData.senderName}`);
            logger.info(`   senderPhoneNumber: ${messageData.senderPhoneNumber}`);
            logger.info(`   content: ${messageData.content ? `${messageData.content.length} символов` : 'пусто'}`);
            logger.info(`   parsedData.products: ${messageData.parsedData.products.length} товар(ов)`);
            logger.info(`   Полный JSON:`, JSON.stringify(messageData, null, 2));
            logger.info('═'.repeat(80));
            
            // Отправляем в Spring Boot API
            try {
              logger.info(`   📤 Отправка товара ${i + 1} в Spring Boot API...`);
              const { sendToMultipleAPIs } = await import('./api-client.js');
              const { getMonitoringConfig } = await import('./config-manager.js');
              const monitoringConfig = getMonitoringConfig();
              const apiConfig = monitoringConfig.api || {};
              
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
              
              logger.info(`   📡 API Targets:`);
              apiTargets.forEach((target, idx) => {
                logger.info(`      ${idx + 1}. ${target.url}${target.endpoint}`);
              });
              
              const results = await sendToMultipleAPIs(messageData, apiTargets);
              
              // Детальное логирование результатов
              logger.info(`   📊 РЕЗУЛЬТАТЫ ОТПРАВКИ:`);
              results.forEach((result, idx) => {
                if (result.success) {
                  logger.info(`      ✅ ${apiTargets[idx].url}: успешно (статус: ${result.response?.status || 'N/A'})`);
                } else {
                  logger.error(`      ❌ ${apiTargets[idx].url}: ошибка - ${result.error}`);
                }
              });
              
              const successCount = results.filter(r => r.success).length;
              logger.info(`   ✅ Товар ${i + 1} отправлен: ${successCount}/${apiTargets.length} API успешно`);
            } catch (apiError) {
              logger.error(`   ❌ Ошибка отправки товара ${i + 1} в Spring Boot: ${apiError.message}`);
              if (apiError.stack) {
                logger.error(`   Стек ошибки: ${apiError.stack.substring(0, 500)}`);
              }
            }
          }
        } else {
          logger.info(`   ℹ️  Нет товаров для отправки в Spring Boot`);
        }
      } else {
        logger.warn(`   ⚠️  parsed_data не является объектом или null`);
      }
    }
    
    logger.info('═'.repeat(80));
    logger.info(`✅ CALLBACK ОБРАБОТАН УСПЕШНО [ID: ${requestId}]`);
    logger.info('═'.repeat(80));
    logger.info('');
    
    res.json({
      success: true,
      message: 'Callback обработан успешно'
    });
    
  } catch (error) {
    logger.error('═'.repeat(80));
    logger.error(`❌ ОШИБКА ОБРАБОТКИ CALLBACK ОТ OLLAMA [ID: ${requestId}]`);
    logger.error('═'.repeat(80));
    logger.error(`Ошибка: ${error.message}`);
    if (error.stack) {
      logger.error(`Стек: ${error.stack}`);
    }
    logger.error('═'.repeat(80));
    logger.error('');
    
    res.status(500).json({ 
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

// Настройка раздачи статических файлов из папки public
// ВАЖНО: должно быть ПОСЛЕ всех API маршрутов, но ПЕРЕД обработчиком 404
const publicPath = path.join(__dirname, 'public');
logger.info(`📁 Настройка статических файлов из: ${publicPath}`);
logger.info(`📁 Проверка существования: ${fs.existsSync(publicPath)}`);

// Логирование для отладки статических файлов (ПЕРЕД express.static)
app.use((req, res, next) => {
  // Пропускаем маршруты, которые уже обработаны выше
  if (req.path === '/restore-contacts' || 
      req.path === '/messages' || 
      req.path === '/chats' || 
      req.path === '/settings' || 
      req.path === '/logs' ||
      req.path === '/api-test' ||
      req.path.startsWith('/api/')) {
    return next();
  }
  
  // Если это запрос статического файла (CSS, JS, изображения и т.д.)
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)) {
    const filePath = path.join(publicPath, req.path);
    logger.info(`📄 Запрос статического файла: ${req.path}`);
    logger.info(`📄 Полный путь: ${filePath}`);
    logger.info(`📄 Файл существует: ${fs.existsSync(filePath)}`);
  }
  next();
});

// Настройка express.static для раздачи статических файлов
app.use(express.static(publicPath, {
  maxAge: '1d', // Кэширование на 1 день
  etag: true,
  lastModified: true,
  index: false // Не показывать индекс файлов
}));

// Финальный обработчик 404 для всех необработанных маршрутов (в конце, после всех API маршрутов и статических файлов)
app.use((req, res) => {
  // Если запрос не был обработан ни одним маршрутом выше
  if (!res.headersSent) {
    logger.warn(`⚠️  404 - маршрут не найден: ${req.method} ${req.path}`);
    res.status(404).json({ 
      error: 'Not found',
      path: req.path,
      method: req.method
    });
  }
});

/**
 * Запуск веб-сервера
 */
export function startWebServer() {
  try {
    logger.info(`🔧 Попытка запуска веб-сервера на порту ${PORT}...`);
    
    const server = app.listen(PORT, () => {
      logger.info(`🌐 Веб-сервер запущен на http://localhost:${PORT}`);
      logger.info(`🌐 Откройте в браузере: http://localhost:${PORT}`);
      logger.info(`📡 Webhook для Ollama: POST http://localhost:${PORT}/api/webhook/ollama-result`);
    });
    
    // Обработка ошибок при запуске сервера
    server.on('error', (error) => {
      logger.error(`❌ Ошибка запуска веб-сервера:`, error);
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Порт ${PORT} уже занят! Остановите другое приложение или измените порт.`);
        logger.error(`❌ Попробуйте остановить процесс: netstat -ano | findstr :${PORT}`);
      } else {
        logger.error(`❌ Неизвестная ошибка:`, error.message);
        logger.error(`❌ Стек ошибки:`, error.stack);
      }
    });
    
    logger.info(`✅ Сервер настроен, ожидание подключений...`);
  } catch (error) {
    logger.error(`❌ Критическая ошибка при запуске веб-сервера:`, error);
    logger.error(`❌ Стек ошибки:`, error.stack);
    process.exit(1);
  }
}

export default app;
