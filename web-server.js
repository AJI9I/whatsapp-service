import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClient, getClientStatus, initializeClient, destroyClient } from './whatsapp-client.js';
import { initializeMessageHandler } from './message-handler.js';
import { 
  getMonitoringConfig, 
  updateApiConfig, 
  updateMonitoredGroups, 
  updateMonitoredPersonalChats,
  loadConfig
} from './config-manager.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { getLogs, clearLogs } from './log-buffer.js';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.WEB_PORT || '3000');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

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
 * Получить QR-код (если доступен)
 */
app.get('/api/qrcode', async (req, res) => {
  const status = getClientStatus();
  
  if (status.qrCode) {
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(status.qrCode);
      res.json({ qrCode: qrCodeDataUrl, status: status.status });
    } catch (error) {
      logger.error('Ошибка генерации QR-кода:', error);
      res.status(500).json({ error: 'Ошибка генерации QR-кода' });
    }
  } else {
    res.json({ qrCode: null, status: status.status });
  }
});

/**
 * Получить информацию о модели Ollama (включая максимальный размер контекста)
 */
app.get('/api/model-info', async (req, res) => {
  try {
    const { createOllamaClient } = await import('./ollama-client.js');
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || null;
    const client = createOllamaClient(ollamaUrl, model);
    
    const modelInfo = await client.getModelInfo();
    
    if (modelInfo) {
      // Извлекаем информацию о модели из разных источников
      let contextSize = null;
      let parameterCount = null;
      let quantization = null;
      let architecture = null;
      let embeddingLength = null;
      
      // Проверяем корневой объект ответа (новый формат Ollama API)
      if (modelInfo.context_length !== undefined) {
        contextSize = modelInfo.context_length;
      }
      if (modelInfo.parameters !== undefined) {
        parameterCount = modelInfo.parameters;
      }
      if (modelInfo.quantization !== undefined) {
        quantization = modelInfo.quantization;
      }
      if (modelInfo.architecture !== undefined) {
        architecture = modelInfo.architecture;
      }
      if (modelInfo.embedding_length !== undefined) {
        embeddingLength = modelInfo.embedding_length;
      }
      
      // Также проверяем details, если есть (старый формат)
      if (modelInfo.details) {
        if (modelInfo.details.context_length !== undefined && !contextSize) {
          contextSize = modelInfo.details.context_length;
        }
        if (modelInfo.details.parameter_count !== undefined && !parameterCount) {
          parameterCount = modelInfo.details.parameter_count;
        }
        if (modelInfo.details.quantization_level !== undefined && !quantization) {
          quantization = modelInfo.details.quantization_level;
        }
      }
      
      // Если не найдено, ищем в modelfile
      if (!contextSize && modelInfo.modelfile) {
        const contextMatch = modelInfo.modelfile.match(/context_length\s+(\d+)|ctx_size\s+(\d+)/i);
        if (contextMatch) {
          contextSize = parseInt(contextMatch[1] || contextMatch[2]);
        }
      }
      
      res.json({
        model: client.model,
        ollamaUrl: ollamaUrl,
        architecture: architecture,
        parameters: parameterCount,
        contextSize: contextSize,
        contextSizeFormatted: contextSize ? `${contextSize.toLocaleString()} токенов (${(contextSize / 1024).toFixed(0)}K)` : 'Не указан',
        embeddingLength: embeddingLength,
        quantization: quantization,
        details: modelInfo.details || null,
        modelfile: modelInfo.modelfile || null,
        fullInfo: modelInfo
      });
    } else {
      res.status(404).json({ error: 'Информация о модели не найдена' });
    }
  } catch (error) {
    logger.error('Ошибка получения информации о модели:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Отправить тестовое сообщение для обработки
 */
app.post('/api/test-message', async (req, res) => {
  try {
    const { content, chatName, senderName, senderPhone, isGroup } = req.body;
    
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Текст сообщения обязателен' });
    }

    // Импортируем функцию обработки тестового сообщения
    const { handleTestMessage } = await import('./message-handler.js');
    
    // Обрабатываем тестовое сообщение
    const result = await handleTestMessage(
      content.trim(),
      chatName || 'Test Group',
      senderName || 'Test User',
      senderPhone || '79999999999',
      isGroup !== false // По умолчанию группа
    );
    
    res.json({
      success: true,
      message: 'Тестовое сообщение успешно обработано',
      result: result
    });
  } catch (error) {
    logger.error('Ошибка обработки тестового сообщения:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * Получить список всех чатов (группы и личные)
 */
app.get('/api/chats', async (req, res) => {
  try {
    const client = getClient();
    
    if (!client || !getClientStatus().isReady) {
      return res.json({ groups: [], personalChats: [] });
    }

    const chats = await client.getChats();
    const groups = [];
    const personalChats = [];

    for (const chat of chats) {
      const chatInfo = {
        id: chat.id._serialized,
        name: chat.name || chat.id.user || 'Unknown',
        isGroup: chat.isGroup,
        unreadCount: await chat.unreadCount,
        lastMessage: (await chat.fetchMessages({ limit: 1 }))[0]?.body?.substring(0, 50) || ''
      };

      if (chat.isGroup) {
        groups.push(chatInfo);
      } else {
        personalChats.push(chatInfo);
      }
    }

    // Сортируем по названию
    groups.sort((a, b) => a.name.localeCompare(b.name));
    personalChats.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ groups, personalChats });
  } catch (error) {
    logger.error('Ошибка получения списка чатов:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить текущую конфигурацию мониторинга
 */
app.get('/api/config', (req, res) => {
  res.json(getMonitoringConfig());
});

/**
 * Обновить API конфигурацию
 */
app.post('/api/config/api', (req, res) => {
  try {
    const { url, endpoint, apiKey } = req.body;
    
    if (!url || !endpoint) {
      return res.status(400).json({ error: 'URL и endpoint обязательны' });
    }

    updateApiConfig(url, endpoint, apiKey);
    logger.info('API конфигурация обновлена:', { url, endpoint });
    
    res.json({ success: true, config: getMonitoringConfig().api });
  } catch (error) {
    logger.error('Ошибка обновления API конфигурации:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Обновить список групп для мониторинга
 */
app.post('/api/config/groups', (req, res) => {
  try {
    const { groups, monitorAll } = req.body;
    
    updateMonitoredGroups(groups || [], monitorAll === true);
    logger.info('Конфигурация групп обновлена:', { groups, monitorAll });
    
    res.json({ success: true, config: getMonitoringConfig() });
  } catch (error) {
    logger.error('Ошибка обновления конфигурации групп:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Обновить список личных чатов для мониторинга
 */
app.post('/api/config/personal', (req, res) => {
  try {
    const { chats, monitorAll } = req.body;
    
    updateMonitoredPersonalChats(chats || [], monitorAll === true);
    logger.info('Конфигурация личных чатов обновлена:', { chats, monitorAll });
    
    res.json({ success: true, config: getMonitoringConfig() });
  } catch (error) {
    logger.error('Ошибка обновления конфигурации личных чатов:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Переподключить WhatsApp клиент
 */
app.post('/api/reconnect', async (req, res) => {
  try {
    logger.info('Переподключение WhatsApp клиента...');
    
    await destroyClient();
    await initializeClient(config.sessionPath);
    initializeMessageHandler();
    
    res.json({ success: true, message: 'Клиент переподключается...' });
  } catch (error) {
    logger.error('Ошибка переподключения:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Получить последние логи
 */
app.get('/api/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100');
    const logs = getLogs(limit);
    
    res.json({ logs, count: logs.length });
  } catch (error) {
    logger.error('Ошибка получения логов:', error);
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
    logger.error('Ошибка очистки логов:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Главная страница
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Запуск веб-сервера
 */
export function startWebServer() {
  try {
    const server = app.listen(PORT, () => {
      logger.info(`🌐 Веб-сервер запущен на http://localhost:${PORT}`);
      logger.info(`🌐 Откройте в браузере: http://localhost:${PORT}`);
    });
    
    // Обработка ошибок при запуске сервера
    server.on('error', (error) => {
      logger.error(`❌ Ошибка запуска веб-сервера:`, error);
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Порт ${PORT} уже занят! Остановите другое приложение или измените порт.`);
        logger.error(`❌ Попробуйте остановить процесс: netstat -ano | findstr :${PORT}`);
      } else {
        logger.error(`❌ Неизвестная ошибка:`, error.message);
      }
    });
  } catch (error) {
    logger.error(`❌ Критическая ошибка при запуске веб-сервера:`, error);
    process.exit(1);
  }
}

export default app;
