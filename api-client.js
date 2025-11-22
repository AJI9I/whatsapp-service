import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Отправляет данные сообщения в API
 * @param {Object} messageData - Данные сообщения
 * @param {string} apiUrl - URL API (если не указан, используется из конфига)
 * @param {string} apiEndpoint - Endpoint API (если не указан, используется из конфига)
 * @param {string} apiKey - API ключ (если не указан, используется из конфига)
 * @param {number} retryCount - Текущая попытка retry
 */
export async function sendToAPI(messageData, apiUrl = null, apiEndpoint = null, apiKey = null, retryCount = 0) {
  const url = `${apiUrl || config.apiUrl}${apiEndpoint || config.apiEndpoint}`;
  const key = apiKey !== null ? apiKey : config.apiKey;
  
  try {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json; charset=utf-8'
    };
    
    // Добавляем API ключ, если он настроен
    if (key) {
      headers['X-API-Key'] = key;
    }
    
    logger.info(`🌐 Отправка сообщения в Spring Boot API: ${url}`, { url: url });
    
    // Подготавливаем данные для логирования (убираем большие поля)
    const messageDataForLog = { ...messageData };
    if (messageDataForLog.mediaData) {
      const mediaSize = Buffer.from(messageData.mediaData, 'base64').length;
      messageDataForLog.mediaData = `[Base64 данные, размер: ${mediaSize} байт]`;
    }
    
    logger.info('📤 JSON данные для отправки в Spring Boot API:', { 
      json: JSON.stringify(messageDataForLog, null, 2),
      messageData: messageDataForLog,
      headers: headers
    });
    
    // Логируем байты для диагностики кодировки
    const jsonString = JSON.stringify(messageData);
    const utf8Bytes = Buffer.from(jsonString, 'utf8');
    logger.debug(`📊 Размер JSON (UTF-8): ${utf8Bytes.length} байт`);
    logger.debug(`📊 UTF-8 байты (первые 100): ${utf8Bytes.slice(0, 100).toString('hex')}`);
    logger.debug(`📤 HTTP заголовки: ${JSON.stringify(headers, null, 2)}`);
    
    const response = await axios.post(url, messageData, { 
      headers: headers,
      timeout: 10000, // 10 секунд таймаут
      responseEncoding: 'utf8',
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    logger.info(`✅ Сообщение успешно отправлено в Spring Boot API`);
    logger.info(`📥 HTTP статус ответа: ${response.status} ${response.statusText}`, { 
      status: response.status,
      statusText: response.statusText
    });
    logger.info(`📥 Ответ от Spring Boot API (JSON):`, { 
      json: JSON.stringify(response.data, null, 2),
      responseData: response.data,
      headers: response.headers
    });
    
    return { success: true, response: response.data };
    
  } catch (error) {
    if (retryCount < config.retryAttempts) {
      const nextRetry = retryCount + 1;
      logger.warn(`❌ Ошибка отправки в API (попытка ${nextRetry}/${config.retryAttempts}): ${error.message}`);
      logger.info(`Повторная попытка через ${config.retryDelay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, config.retryDelay));
      return sendToAPI(messageData, apiUrl, apiEndpoint, apiKey, nextRetry);
    } else {
      logger.error('═'.repeat(80));
      logger.error(`❌ НЕ УДАЛОСЬ ОТПРАВИТЬ СООБЩЕНИЕ В SPRING BOOT API ПОСЛЕ ${config.retryAttempts} ПОПЫТОК`);
      logger.error('═'.repeat(80));
      logger.error(`Ошибка: ${error.message}`, { error: error.message, errorStack: error.stack });
      
      if (error.response) {
        logger.error(`📥 HTTP статус ошибки: ${error.response.status} ${error.response.statusText}`, { 
          status: error.response.status,
          statusText: error.response.statusText
        });
        logger.error(`📥 Ответ от Spring Boot API при ошибке (JSON):`, { 
          json: JSON.stringify(error.response.data, null, 2),
          errorData: error.response.data
        });
        
        if (error.response.headers) {
          logger.error(`📥 HTTP заголовки ответа:`, { 
            headers: JSON.stringify(error.response.headers, null, 2)
          });
        }
      } else if (error.request) {
        logger.error('📥 Запрос был отправлен, но ответа не получено', { url: url });
      } else {
        logger.error(`📥 Ошибка настройки запроса: ${error.message}`, { error: error.message });
      }
      
      logger.error('═'.repeat(80));
      logger.error('');
      
      return { success: false, error: error.message };
    }
  }
}

