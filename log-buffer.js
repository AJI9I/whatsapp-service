/**
 * Буфер для хранения последних логов в памяти
 * Используется для отображения логов в веб-интерфейсе
 */

// Максимальное количество логов в буфере
const MAX_LOGS = 1000;

// Буфер логов
const logBuffer = [];

/**
 * Добавляет лог в буфер
 * @param {Object} logEntry - Объект лога с полями: timestamp, level, message, data
 */
export function addLog(logEntry) {
  logBuffer.push(logEntry);
  
  // Ограничиваем размер буфера
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift(); // Удаляем самый старый лог
  }
}

/**
 * Получает последние N логов
 * @param {number} limit - Количество последних логов (по умолчанию 100)
 * @returns {Array} Массив логов
 */
export function getLogs(limit = 100) {
  return logBuffer.slice(-limit);
}

/**
 * Очищает буфер логов
 */
export function clearLogs() {
  logBuffer.length = 0;
}

/**
 * Получает количество логов в буфере
 */
export function getLogCount() {
  return logBuffer.length;
}

