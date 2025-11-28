import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Директория для логов сообщений
const messagesLogsDir = path.join(__dirname, 'logs', 'messages');
if (!fs.existsSync(messagesLogsDir)) {
  fs.mkdirSync(messagesLogsDir, { recursive: true });
}

// Период хранения логов в днях
const LOG_RETENTION_DAYS = 2;

/**
 * Получает путь к файлу лога для входящих сообщений
 * @param {Date} date - Дата для лога
 * @returns {string} Путь к файлу лога
 */
function getIncomingMessagesLogPath(date = new Date()) {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(messagesLogsDir, `incoming-${dateStr}.txt`);
}

/**
 * Получает путь к файлу лога для отправленных сообщений
 * @param {Date} date - Дата для лога
 * @returns {string} Путь к файлу лога
 */
function getSentMessagesLogPath(date = new Date()) {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(messagesLogsDir, `sent-${dateStr}.txt`);
}

/**
 * Очищает старые логи (старше LOG_RETENTION_DAYS дней)
 */
function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(messagesLogsDir);
    const now = Date.now();
    const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    
    files.forEach(file => {
      const filePath = path.join(messagesLogsDir, file);
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;
      
      if (fileAge > retentionMs) {
        fs.unlinkSync(filePath);
        console.log(`🗑️  Удален старый лог: ${file}`);
      }
    });
  } catch (error) {
    console.error(`❌ Ошибка при очистке старых логов: ${error.message}`);
  }
}

/**
 * Записывает сообщение в лог-файл
 * @param {string} logPath - Путь к файлу лога
 * @param {Object} data - Данные для логирования
 */
function writeToLog(logPath, data) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp: timestamp,
      ...data
    };
    
    const logLine = JSON.stringify(logEntry, null, 2);
    const separator = '\n' + '='.repeat(80) + '\n';
    
    // Добавляем в файл (создаем если не существует)
    fs.appendFileSync(logPath, separator + logLine + '\n', 'utf8');
  } catch (error) {
    console.error(`❌ Ошибка записи в лог ${logPath}: ${error.message}`);
  }
}

/**
 * Логирует входящее сообщение для обработки
 * @param {Object} messageData - Данные входящего сообщения
 */
export function logIncomingMessage(messageData) {
  const logPath = getIncomingMessagesLogPath();
  
  // Создаем упрощенную копию данных (без больших медиа)
  const logData = {
    messageId: messageData.messageId,
    chatId: messageData.chatId,
    chatName: messageData.chatName,
    chatType: messageData.chatType,
    senderId: messageData.senderId,
    senderName: messageData.senderName,
    senderUsername: messageData.senderUsername,
    senderPhoneNumber: messageData.senderPhoneNumber,
    content: messageData.content,
    timestamp: messageData.timestamp,
    hasMedia: messageData.hasMedia,
    messageType: messageData.messageType,
    isForwarded: messageData.isForwarded,
    source: messageData.source || 'whatsapp',
    // Медиа данные не сохраняем в лог (слишком большие)
    mediaInfo: messageData.hasMedia ? {
      mimetype: messageData.mediaMimetype,
      filename: messageData.mediaFilename,
      size: messageData.mediaSize
    } : null,
    // ParsedData сохраняем (если есть)
    parsedData: messageData.parsedData || null,
    // Объяснение от Ollama (если есть в parsedData)
    explanation: messageData.parsedData?.explanation || null
  };
  
  writeToLog(logPath, {
    type: 'INCOMING_MESSAGE',
    ...logData
  });
  
  // Периодически очищаем старые логи (при каждом 100-м сообщении)
  if (Math.random() < 0.01) {
    cleanupOldLogs();
  }
}

/**
 * Логирует отправленное сообщение на бэкенд
 * @param {Object} messageData - Данные отправленного сообщения
 * @param {string} url - URL бэкенда
 * @param {boolean} success - Успешность отправки
 * @param {Object} response - Ответ от сервера (если есть)
 * @param {string} error - Ошибка (если есть)
 */
export function logSentMessage(messageData, url, success, response = null, error = null) {
  const logPath = getSentMessagesLogPath();
  
  // Создаем упрощенную копию данных (без больших медиа)
  const logData = {
    messageId: messageData.messageId,
    chatId: messageData.chatId,
    chatName: messageData.chatName,
    chatType: messageData.chatType,
    senderId: messageData.senderId,
    senderName: messageData.senderName,
    senderPhoneNumber: messageData.senderPhoneNumber,
    content: messageData.content,
    timestamp: messageData.timestamp,
    url: url,
    success: success,
    // Медиа данные не сохраняем в лог (слишком большие)
    mediaInfo: messageData.hasMedia ? {
      mimetype: messageData.mediaMimetype,
      filename: messageData.mediaFilename,
      size: messageData.mediaSize
    } : null,
    // ParsedData сохраняем (если есть)
    parsedData: messageData.parsedData || null,
    // Объяснение от Ollama (если есть в parsedData)
    explanation: messageData.parsedData?.explanation || null,
    // Ответ сервера или ошибка
    response: response || null,
    error: error || null
  };
  
  writeToLog(logPath, {
    type: success ? 'SENT_MESSAGE_SUCCESS' : 'SENT_MESSAGE_ERROR',
    ...logData
  });
  
  // Периодически очищаем старые логи (при каждом 100-м сообщении)
  if (Math.random() < 0.01) {
    cleanupOldLogs();
  }
}

/**
 * Инициализация: очистка старых логов при запуске
 */
export function initializeMessagesLogger() {
  cleanupOldLogs();
  console.log(`✅ Messages logger инициализирован. Логи хранятся ${LOG_RETENTION_DAYS} дня в ${messagesLogsDir}`);
}



