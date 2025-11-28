import axios from 'axios';
import { logger } from './logger.js';
import { buildPrompt, getDefaultSettings } from '../ollama-config/prompt.js';

/**
 * Класс для взаимодействия с Ollama API
 */
export class OllamaClient {
  constructor(ollamaUrl = 'http://localhost:11434', model = null) {
    this.ollamaUrl = ollamaUrl;
    this.model = model || process.env.OLLAMA_MODEL || 'gpt-oss:20b';
    this.modelInfo = null;
    
    // Используем настройки по умолчанию из общего конфига
    const defaultSettings = getDefaultSettings();
    this.contextSize = parseInt(process.env.OLLAMA_NUM_CTX || defaultSettings.contextSize.toString());
    this.numPredict = parseInt(process.env.OLLAMA_NUM_PREDICT || defaultSettings.numPredict.toString());
    this.requestTimeout = parseInt(process.env.OLLAMA_TIMEOUT || defaultSettings.requestTimeout.toString());
    this.modelInfoTimeout = parseInt(process.env.OLLAMA_MODEL_INFO_TIMEOUT || defaultSettings.modelInfoTimeout.toString());
    
    // Настройки GPU для Ollama
    // num_gpu: количество GPU для использования (по умолчанию -1 = автоматически, или 0 для отключения GPU)
    this.numGpu = process.env.OLLAMA_NUM_GPU !== undefined 
      ? parseInt(process.env.OLLAMA_NUM_GPU) 
      : -1; // -1 = автоматически использовать все доступные GPU
  }

  /**
   * Получает информацию о модели Ollama
   */
  async getModelInfo() {
    if (this.modelInfo) {
      return this.modelInfo;
    }

    try {
      const response = await axios.post(
        `${this.ollamaUrl}/api/show`,
        { name: this.model },
        { timeout: this.modelInfoTimeout }
      );

      this.modelInfo = response.data;
      return this.modelInfo;
    } catch (error) {
      logger.error('❌ Ошибка при получении информации о модели:', error.message);
      throw error;
    }
  }

  /**
   * Парсит сообщение через Ollama для извлечения информации о товарах
   */
  /**
   * Парсит сообщение через Ollama для извлечения информации о товарах
   * @param {string} messageContent - Текст сообщения для парсинга
   * @returns {Promise<Object|null>} Распарсенные данные или null при ошибке
   */
  async parseMessage(messageContent, logOllamaResponse = true) {
    // Проверяем входные данные
    if (!messageContent || typeof messageContent !== 'string' || messageContent.trim().length === 0) {
      logger.error('❌ Пустое сообщение для парсинга');
      return null;
    }

    if (logOllamaResponse) {
      logger.info(`📤 Парсинг сообщения через Ollama (${messageContent.length} символов)`);
    }
    
    // Получаем информацию о модели (если еще не получена)
    if (!this.modelInfo) {
      try {
        await this.getModelInfo();
      } catch (error) {
        logger.warn('⚠️  Не удалось получить информацию о модели, продолжаем без неё');
      }
    }

    // Используем общий промпт из ollama-config
    const isReasoningModel = this.model.includes('gpt-oss');
    const prompt = buildPrompt(messageContent, isReasoningModel);

    try {
      if (logOllamaResponse) {
        logger.info(`🤖 Отправка запроса в Ollama (модель: ${this.model})`);
      }

      // Для модели gpt-oss отключаем format: 'json', так как она использует thinking/reasoning формат
      const useJsonFormat = !this.model.includes('gpt-oss');
      
      // Для больших моделей типа gpt-oss увеличиваем num_predict
      // Используем минимум 32k для gpt-oss, так как он может генерировать длинные ответы
      const adjustedNumPredict = this.model.includes('gpt-oss') ? Math.max(this.numPredict, 32768) : this.numPredict;
      
      // Подготавливаем данные запроса
      const requestData = {
        model: this.model,
        prompt: prompt,
        stream: false,
        ...(useJsonFormat && { format: 'json' }),
        num_ctx: this.contextSize,
        num_predict: adjustedNumPredict,
        options: {
          num_ctx: this.contextSize,
          num_predict: adjustedNumPredict,
          num_gpu: this.numGpu
        }
      };

      if (logOllamaResponse) {
        logger.debug(`📤 Запрос к Ollama:`, JSON.stringify({ model: this.model, promptLength: prompt.length, contextSize: this.contextSize, numPredict: adjustedNumPredict }, null, 2));
      }

      // Отправляем запрос к Ollama
      let response;
      try {
        response = await axios.post(
          `${this.ollamaUrl}/api/generate`,
          requestData,
          {
            timeout: this.requestTimeout,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (requestError) {
        // Обработка таймаута
        if (requestError.code === 'ECONNABORTED' || requestError.message?.includes('timeout')) {
          logger.error(`❌ Таймаут при запросе к Ollama (${this.requestTimeout / 1000} сек)`);
        }
        throw requestError;
      }

      // Проверяем ответ на обрезку из-за лимита токенов
      // ВАЖНО: это критично, поэтому логируем всегда, даже если logOllamaResponse выключен
      if (response.data) {
        const doneReason = response.data.done_reason;
        
        // Критическое предупреждение, если ответ обрезан из-за лимита токенов
        if (doneReason === 'length') {
          logger.error('═'.repeat(80));
          logger.error('❌ ❌ ❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: ОТВЕТ OLLAMA ОБРЕЗАН ИЗ-ЗА ЛИМИТА ТОКЕНОВ! ❌ ❌ ❌');
          logger.error('═'.repeat(80));
          logger.error(`   Модель: ${this.model}`);
          logger.error(`   Текущий лимит num_predict: ${adjustedNumPredict} токенов`);
          logger.error(`   Размер контекста num_ctx: ${this.contextSize} токенов`);
          logger.error(`   Размер промпта: ${prompt.length} символов (~${Math.ceil(prompt.length / 4)} токенов)`);
          
          // Пытаемся логировать размер ответа
          if (response.data.response) {
            let responseLength = 0;
            try {
              if (typeof response.data.response === 'string') {
                responseLength = response.data.response.length;
              } else if (typeof response.data.response === 'object') {
                // Пытаемся извлечь строку из объекта с числовыми ключами
                const converted = this.convertObjectToString(response.data.response);
                responseLength = converted ? converted.length : JSON.stringify(response.data.response).length;
              }
            } catch (e) {
              responseLength = JSON.stringify(response.data.response).length;
            }
            logger.error(`   Размер полученного ответа: ${responseLength} символов (~${Math.ceil(responseLength / 4)} токенов)`);
          }
          
          logger.error(`   РЕКОМЕНДАЦИЯ: Увеличьте OLLAMA_NUM_PREDICT до ${adjustedNumPredict * 2} или больше`);
          logger.error(`   Или установите переменную окружения: export OLLAMA_NUM_PREDICT=${adjustedNumPredict * 2}`);
          logger.error('═'.repeat(80));
        } else if (doneReason && logOllamaResponse) {
          // Для других done_reason логируем только если включено детальное логирование
          logger.debug(`📥 Ответ от Ollama получен: done_reason=${doneReason}`);
        }
        
        if (logOllamaResponse) {
          logger.debug(`📥 Детали ответа от Ollama:`, {
            done_reason: doneReason || 'stop',
            hasResponse: !!response.data?.response,
            hasThinking: !!response.data?.thinking,
            contextSize: this.contextSize,
            numPredict: adjustedNumPredict,
            promptLength: prompt.length
          });
        }
      }

      // Извлекаем и валидируем данные
      const parsedData = this.extractParsedData(response, messageContent, logOllamaResponse);
      if (!parsedData) {
        if (logOllamaResponse) {
          logger.error('❌ Не удалось извлечь данные из ответа Ollama');
        }
        return null;
      }

      const validatedData = this.validateParsedData(parsedData, messageContent);
      if (logOllamaResponse) {
        logger.info(`✅ Парсинг завершен: ${validatedData.isMiningEquipment ? 'оборудование' : 'не оборудование'}, товаров: ${validatedData.products?.length || 0}`);
      }

      return validatedData;
    } catch (error) {
      // Упрощенное логирование ошибки
      const errorMessage = error?.message || String(error) || 'Неизвестная ошибка';
      const errorCode = error?.code || '';
      
      logger.error(`❌ Ошибка при запросе к Ollama: ${errorMessage}`);
      
      if (errorCode === 'ECONNABORTED' || errorMessage.includes('timeout')) {
        logger.error(`⏱️  Таймаут: ${this.requestTimeout / 1000} сек, модель: ${this.model}`);
      }
      
      if (error?.response) {
        logger.error(`HTTP статус: ${error.response.status}`);
      }
      
      if (error?.stack) {
        logger.error(`Стек: ${error.stack.substring(0, 500)}`);
      }
      
      throw error;
    }
  }


  /**
   * Извлекает распарсенные данные из ответа Ollama
   */
  /**
   * Преобразует объект с числовыми ключами (строка в виде объекта) обратно в строку
   * Например: {"0": "a", "1": "b", "2": "c"} -> "abc"
   * Или: {"635": "c", "636": "o", "637": "m"} -> "com"
   */
  convertObjectToString(obj) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return null;
    }
    
    // Проверяем, все ли ключи - числа
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return null;
    }
    
    // Проверяем, что все ключи - числа (или строки, представляющие числа)
    const numericKeys = [];
    for (const key of keys) {
      const num = Number(key);
      if (isNaN(num) || num < 0 || num.toString() !== key) {
        // Если хотя бы один ключ не число, это не наш случай
        return null;
      }
      numericKeys.push(num);
    }
    
    // Сортируем ключи по числовому значению
    numericKeys.sort((a, b) => a - b);
    
    // Собираем строку из значений, используя сортированные ключи
    let result = '';
    for (const key of numericKeys) {
      const value = obj[key.toString()];
      if (typeof value === 'string') {
        result += value;
      } else {
        // Если значение не строка, это не наш случай
        return null;
      }
    }
    
    return result.length > 0 ? result : null;
  }

  /**
   * Извлекает распарсенные данные из ответа Ollama
   * Упрощенная версия - только основная логика извлечения JSON
   */
  extractParsedData(response, originalMessage, logOllamaResponse = true) {
    try {
      if (!response || !response.data) {
        logger.error('❌ Нет данных в ответе от Ollama');
        return null;
      }

      // Получаем текст ответа из response или thinking
      let responseText = '';
      
      // Сначала пытаемся получить response
      if (response.data.response) {
        const responseData = response.data.response;
        
        // Проверяем, не является ли response объектом с числовыми ключами
        if (typeof responseData === 'object' && responseData !== null && !Array.isArray(responseData)) {
          const convertedString = this.convertObjectToString(responseData);
          responseText = convertedString || JSON.stringify(responseData);
        } else {
          responseText = String(responseData);
        }
      }
      
      // Если response пустой, пробуем thinking (для моделей с reasoning)
      if (!responseText || responseText.trim() === '') {
        if (response.data.thinking) {
          const thinkingData = response.data.thinking;
          if (typeof thinkingData === 'object' && thinkingData !== null && !Array.isArray(thinkingData)) {
            const convertedString = this.convertObjectToString(thinkingData);
            responseText = convertedString || JSON.stringify(thinkingData);
          } else {
            responseText = String(thinkingData);
          }
        }
      }

      if (!responseText || responseText.trim() === '') {
        logger.error('❌ Пустой ответ от Ollama');
        return null;
      }

      // Проверяем на ошибки в ответе
      if (responseText.toLowerCase().includes('error')) {
        logger.error('❌ Ошибка в ответе Ollama:', responseText.substring(0, 500));
        return null;
      }

      // Пытаемся найти и распарсить JSON
      let jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (logOllamaResponse) {
            logger.info('✅ JSON успешно распарсен из ответа Ollama');
            // Детальное логирование ответа (если включено)
            logger.debug(`📋 Детали ответа Ollama:`, JSON.stringify(parsed, null, 2));
          }
          return parsed;
        } catch (parseError) {
          if (logOllamaResponse) {
            logger.warn('⚠️  Ошибка парсинга JSON, пробуем исправить...');
            logger.debug(`Ошибка парсинга: ${parseError.message}`);
            logger.debug(`JSON фрагмент (первые 500 символов): ${jsonMatch[0].substring(0, 500)}`);
          }
        }
      }

      // Пытаемся исправить обрезанный JSON
      const lastBrace = responseText.lastIndexOf('}');
      if (lastBrace > 0) {
        try {
          const truncated = responseText.substring(0, lastBrace + 1);
          const parsed = JSON.parse(truncated);
          if (logOllamaResponse) {
            logger.info('✅ JSON успешно исправлен и распарсен');
            logger.debug(`📋 Исправленный ответ Ollama:`, JSON.stringify(parsed, null, 2));
          }
          return parsed;
        } catch (e) {
          if (logOllamaResponse) {
            logger.warn('⚠️  Не удалось исправить JSON');
            logger.debug(`Ошибка исправления: ${e.message}`);
          }
        }
      }

      if (logOllamaResponse) {
        logger.error('❌ Не удалось извлечь JSON из ответа Ollama');
        logger.error('Ответ (первые 1000 символов):', responseText.substring(0, 1000));
        logger.debug(`Полный ответ (для отладки):`, responseText);
      }
      return null;
    } catch (error) {
      logger.error('❌ Ошибка при извлечении данных:', error.message);
      return null;
    }
  }

  /**
   * Валидирует распарсенные данные от Ollama
   * Упрощенная валидация - только базовая проверка структуры
   */
  validateParsedData(parsedData, originalMessage) {
    // Если это не оборудование для майнинга, возвращаем как есть
    if (parsedData && parsedData.isMiningEquipment === false) {
      return parsedData;
    }
    
    // Если нет данных или нет массива products, возвращаем как есть
    if (!parsedData || !parsedData.products || !Array.isArray(parsedData.products)) {
      return parsedData;
    }

    // Фильтруем только товары с моделью (базовая проверка)
    const validatedProducts = parsedData.products.filter(product => {
      const model = (product.model || '').trim();
      return model && model.length > 0;
    });

    // Возвращаем данные с отфильтрованными продуктами
    return {
      ...parsedData,
      products: validatedProducts
    };
  }
}

/**
 * Создает экземпляр OllamaClient
 */
export function createOllamaClient(ollamaUrl, model) {
  return new OllamaClient(ollamaUrl, model);
}
