import axios from 'axios';
import { logger } from './logger.js';

/**
 * Клиент для взаимодействия с Ollama Service через HTTP API
 */
export class OllamaServiceClient {
  constructor(ollamaServiceUrl = 'http://localhost:4000') {
    this.ollamaServiceUrl = ollamaServiceUrl;
    this.defaultPromptId = 1; // ID дефолтного промпта для парсинга оборудования майнинга
  }

  /**
   * Отправляет сообщение в Ollama Service для парсинга
   * @param {string} message - Текст сообщения
   * @param {number} whatsappMessageId - ID сообщения из БД WhatsApp Service
   * @param {number} promptId - ID промпта (по умолчанию 1)
   * @param {string} callbackUrl - URL для callback после обработки
   * @param {boolean} logResponse - Логировать ли ответ
   * @returns {Promise<Object>} Результат: { success, task_id, status, message }
   */
  async parseMessage(message, whatsappMessageId, promptId = null, callbackUrl = null, logResponse = false) {
    try {
      const url = `${this.ollamaServiceUrl}/api/parse`;
      
      // Определяем финальный promptId
      const finalPromptId = promptId || this.defaultPromptId;
      
      const requestData = {
        message: message,
        logResponse: logResponse,
        whatsapp_message_id: whatsappMessageId,
        prompt_id: finalPromptId,
        callback_url: callbackUrl || `${process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3000'}/api/webhook/ollama-result`
      };

      logger.info('═'.repeat(80));
      logger.info('📤 ОТПРАВКА СООБЩЕНИЯ В OLLAMA SERVICE');
      logger.info('═'.repeat(80));
      logger.info(`   URL: ${url}`);
      logger.info(`   WhatsApp Message ID: ${whatsappMessageId}`);
      logger.info(`   Prompt ID: ${finalPromptId} ${promptId ? '(передан)' : '(дефолтный)'}`);
      logger.info(`   Callback URL: ${requestData.callback_url}`);
      logger.info(`   Log Response: ${logResponse}`);
      logger.info(`   Message length: ${message ? message.length : 0} символов`);
      logger.info(`   Message preview: ${message ? message.substring(0, 100) + (message.length > 100 ? '...' : '') : 'N/A'}`);
      logger.info('═'.repeat(80));
      logger.info('');

      const response = await axios.post(url, requestData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      });

      logger.info('═'.repeat(80));
      logger.info('📥 ОТВЕТ ОТ OLLAMA SERVICE');
      logger.info('═'.repeat(80));
      logger.info(`   HTTP статус: ${response.status}`);
      logger.info(`   Данные ответа: ${JSON.stringify(response.data, null, 2)}`);
      logger.info('═'.repeat(80));
      logger.info('');

      if (response.data && response.data.success) {
        logger.info(`✅ Сообщение #${whatsappMessageId} принято Ollama Service (Task ID: ${response.data.task_id || 'N/A'})`);
        return response.data;
      } else {
        logger.error(`❌ Ollama Service вернул неуспешный ответ`);
        logger.error(`   Ответ: ${JSON.stringify(response.data)}`);
        throw new Error('Ollama Service вернул неуспешный ответ');
      }
    } catch (error) {
      logger.error('═'.repeat(80));
      logger.error('❌ ОШИБКА ОТПРАВКИ СООБЩЕНИЯ В OLLAMA SERVICE');
      logger.error('═'.repeat(80));
      logger.error(`Ошибка: ${error.message}`);
      if (error.response) {
        logger.error(`   HTTP статус: ${error.response.status}`);
        logger.error(`   Данные ответа: ${JSON.stringify(error.response.data)}`);
      }
      if (error.request) {
        logger.error(`   Запрос отправлен, но ответа нет`);
        logger.error(`   URL: ${url}`);
      }
      if (error.code) {
        logger.error(`   Код ошибки: ${error.code}`);
      }
      if (error.stack) {
        logger.error(`   Стек: ${error.stack}`);
      }
      logger.error('═'.repeat(80));
      logger.error('');
      throw error;
    }
  }
}

// Создаем экземпляр клиента
const ollamaServiceUrl = process.env.OLLAMA_SERVICE_URL || 'http://localhost:4000';
export const ollamaServiceClient = new OllamaServiceClient(ollamaServiceUrl);

