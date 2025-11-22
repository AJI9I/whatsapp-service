import axios from 'axios';
import { logger } from './logger.js';

/**
 * Класс для взаимодействия с Ollama API
 */
export class OllamaClient {
  constructor(ollamaUrl = 'http://localhost:11434', model = null) {
    this.ollamaUrl = ollamaUrl;
    this.model = model || process.env.OLLAMA_MODEL || 'gpt-oss:20b';
    this.modelInfo = null;
    // Увеличено для обработки длинных сообщений с большим количеством товаров
    this.contextSize = parseInt(process.env.OLLAMA_NUM_CTX || '16384');
    this.numPredict = parseInt(process.env.OLLAMA_NUM_PREDICT || '8192');
    // Для больших моделей типа gpt-oss:20b увеличиваем таймаут до 10 минут (600000ms)
    // Если модель не указана в env, используем увеличенный таймаут для gpt-oss по умолчанию
    const finalModel = this.model || process.env.OLLAMA_MODEL || 'gpt-oss:20b';
    const defaultTimeout = finalModel.includes('gpt-oss') ? '600000' : '180000';
    this.requestTimeout = parseInt(process.env.OLLAMA_TIMEOUT || defaultTimeout);
    this.modelInfoTimeout = parseInt(process.env.OLLAMA_MODEL_INFO_TIMEOUT || '120000');
    
    // Настройки GPU для Ollama
    // num_gpu: количество GPU для использования (по умолчанию -1 = автоматически, или 0 для отключения GPU)
    // Если указан OLLAMA_NUM_GPU, используем его, иначе используем все доступные GPU
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
  async parseMessage(messageContent, messageContext = {}) {
    if (!this.modelInfo) {
      try {
        await this.getModelInfo();
      } catch (error) {
        logger.warn('⚠️  Не удалось получить информацию о модели, продолжаем без неё');
      }
    }

    const prompt = this.buildPrompt(messageContent, messageContext);

    try {
      logger.info('═'.repeat(80));
      logger.info('🤖 ОТПРАВКА ЗАПРОСА В OLLAMA ДЛЯ ПАРСИНГА СООБЩЕНИЯ');
      logger.info('═'.repeat(80));
      logger.info(`📤 Ollama URL: ${this.ollamaUrl}/api/generate`);
      logger.info(`📤 Модель: ${this.model}`);
      logger.info(`📏 Настройки контекста запроса: num_ctx=${this.contextSize.toLocaleString()} токенов, num_predict=${this.numPredict.toLocaleString()} токенов`);
      logger.info(`📝 Длина промпта: ${prompt.length} символов (~${Math.ceil(prompt.length / 4)} токенов)`);
      logger.info('');
      logger.info('📋 ИСХОДНОЕ СООБЩЕНИЕ ИЗ WHATSAPP:');
      logger.info('─'.repeat(80));
      logger.info(messageContent);
      logger.info('─'.repeat(80));
      logger.info('');

      // Для модели gpt-oss:20b отключаем format: 'json', так как она использует thinking/reasoning формат
      const useJsonFormat = !this.model.includes('gpt-oss');
      
      // Для больших моделей типа gpt-oss увеличиваем num_predict для завершения генерации
      const adjustedNumPredict = this.model.includes('gpt-oss') ? Math.max(this.numPredict, 16384) : this.numPredict;
      
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
          // Явно указываем использование GPU (если num_gpu = -1, Ollama использует все доступные GPU)
          // Если num_gpu = 0, GPU отключен и используется CPU
          num_gpu: this.numGpu
        }
      };
      
      // Логируем настройки GPU
      if (this.numGpu === -1) {
        logger.info('🎮 Настройка GPU: автоматическое использование всех доступных GPU');
      } else if (this.numGpu === 0) {
        logger.info('⚠️  Настройка GPU: GPU отключен, используется CPU');
      } else {
        logger.info(`🎮 Настройка GPU: используется ${this.numGpu} GPU`);
      }
      
      if (!useJsonFormat) {
        logger.info('⚠️  Для модели gpt-oss отключен format: json (модель использует reasoning формат)');
        logger.info(`⚠️  Увеличено num_predict до ${adjustedNumPredict} для завершения генерации`);
      }

      logger.info(`⏱️  Используемый таймаут для запроса: ${this.requestTimeout} мс (${this.requestTimeout / 1000} секунд)`);
      logger.info('');

      const response = await axios.post(
        `${this.ollamaUrl}/api/generate`,
        requestData,
        {
          timeout: this.requestTimeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('✅ ПОЛУЧЕН ОТВЕТ ОТ OLLAMA');
      logger.info(`📥 HTTP Статус: ${response.status}`);
      logger.info('');
      
      // Логируем полный ответ от Ollama для отладки
      if (response.data) {
        logger.info('📥 ПОЛНЫЙ ОТВЕТ ОТ OLLAMA:');
        logger.info(JSON.stringify(response.data, null, 2));
        logger.info('');
      }

      if (response.data && response.data.done_reason) {
        logger.info(`📊 ПРИЧИНА ЗАВЕРШЕНИЯ: ${response.data.done_reason}`);
        if (response.data.eval_count) {
          logger.info(`📊 СГЕНЕРИРОВАНО ТОКЕНОВ: ${response.data.eval_count} (лимит был: ${this.numPredict})`);
        }

        if (response.data.done_reason === 'length' || response.data.done_reason === 'max_tokens') {
          logger.error('═'.repeat(80));
          logger.error('❌ ВНИМАНИЕ: ОТВЕТ OLLAMA ОБОРВАЛСЯ ИЗ-ЗА ЛИМИТА ТОКЕНОВ!');
          logger.error('═'.repeat(80));
        }
      }

      const parsedData = this.extractParsedData(response, messageContent);
      const validatedData = this.validateParsedData(parsedData, messageContent);

      return validatedData;
    } catch (error) {
      logger.error('═'.repeat(80));
      logger.error('❌ ОШИБКА ПРИ ЗАПРОСЕ К OLLAMA');
      logger.error('═'.repeat(80));
      logger.error(`Ошибка: ${error.message}`);
      if (error.response) {
        logger.error(`Статус ответа: ${error.response.status}`);
        logger.error(`Тело ответа:`, JSON.stringify(error.response.data, null, 2));
      }
      if (error.stack) {
        logger.error(`Стек: ${error.stack}`);
      }
      logger.error('═'.repeat(80));
      logger.error('');
      throw error;
    }
  }

  buildPrompt(messageContent, messageContext) {
    // Для моделей с reasoning форматом (gpt-oss) добавляем специальную инструкцию
    const isReasoningModel = this.model.includes('gpt-oss');
    const reasoningInstruction = isReasoningModel 
      ? `\n\n⚠️ ВАЖНО: Верни ТОЛЬКО финальный JSON ответ. НЕ пиши рассуждения, НЕ используй thinking/reasoning. Просто извлеки данные и верни JSON.\n`
      : '';
    
    return `ВЕРНИ ТОЛЬКО JSON БЕЗ КОММЕНТАРИЕВ!${reasoningInstruction}

═══════════════════════════════════════════════════════════════════════════════
СООБЩЕНИЕ:
═══════════════════════════════════════════════════════════════════════════════
${messageContent}

═══════════════════════════════════════════════════════════════════════════════
ИНСТРУКЦИЯ:
═══════════════════════════════════════════════════════════════════════════════
1. ПРОЧИТАЙ СООБЩЕНИЕ ВЫШЕ
2. ИЗВЛЕКИ ДАННЫЕ ТОЛЬКО ИЗ ЭТОГО СООБЩЕНИЯ
3. НЕ используй примеры из инструкции!
4. НЕ добавляй данные, которых НЕТ в сообщении!
5. ВЕРНИ ТОЛЬКО JSON - никаких рассуждений, комментариев или thinking!

═══════════════════════════════════════════════════════════════════════════════
ПРАВИЛА:
═══════════════════════════════════════════════════════════════════════════════
1. ТИП ОПЕРАЦИИ - КРИТИЧЕСКИ ВАЖНО:
   - Если есть ЦЕНА (например, "2550 usdt", "300$") И НЕТ слова "Куплю"/"Ищу" -> operationType: "SELL"
   - "Куплю"/"куплю"/"Ищу"/"ищу" -> operationType: "BUY"
   - "Продам"/"продаю"/"В наличии"/"в наличии" -> operationType: "SELL"
   - Пример: "S21+ 235th \n2шт\nотправка из Брянска\n2550 usdt" -> operationType: "SELL" (есть цена!)

2. МОДЕЛЬ:
   - "j pro"/"jpro" -> "S19j PRO"
   - "jpro+" -> "S19j PRO+"
   - "k pro" -> "S19k PRO"
   - "m30s++" -> "M30S++"
   - "z15e" -> "Z15e"
   - "z15" -> "Z15"
   - "l9" -> "L9"
   - "L9" -> "L9"
   - "L7" -> "L7"
   - "S21+" -> "S21+" (это модель S21 с модификацией +)
   - "S21XP" -> "S21 XP"
   - "S21e" -> "S21e"
   - "S21pro" -> "S21 PRO"
   - "S21" -> "S21"
   - "M60s+" -> "M60s+"
   - "M63s+" -> "M63s+"
   - "M63S" -> "M63S"
   - "M61s+" -> "M61s+"
   - "DG1+" -> "DG1+"
   - "DGhome" -> "DGhome"

3. HASHRATE:
   - "104T"/"104th" -> "104TH/s"
   - "235th"/"235T" -> "235TH/s"
   - "15G" -> "15GH/s" (для L9)
   - "16G" -> "16GH/s" (для L9)
   - "9500M"/"9300M"/"9050M"/"8800M" -> "9500MH/s"/"9300MH/s"/"9050MH/s"/"8800MH/s" (для L7)
   - "200ksol" -> "200KSol/s" (для Z15/Z15e)

4. ЦЕНА И ВАЛЮТА:
   - "2550 usdt" -> price: 2550, currency: "USDT"
   - "220 usdt" -> price: 220, currency: "USDT"
   - "300$" -> price: 300, currency: "USD"

5. КОЛИЧЕСТВО:
   - "2шт"/"2 шт" -> quantity: 2
   - "20 шт"/"20шт" -> quantity: 20
   - "Лот 60шт" -> quantity: 60
   - Если количество не указано -> quantity: 1 (для прайс-листа)

6. ЛОКАЦИЯ:
   - "Брянск" -> location: "Брянск"
   - "СОЛНЕЧНОГОРСК." -> location: "Солнечногорск"
   - "Солнечногорск" -> location: "Солнечногорск"
   - "Москва" -> location: "Москва"
   - "МОСКВА" -> location: "Москва"
   - "отправка из Брянска" -> location: "Брянск"
   - "в Москве" -> location: "Москва"
   - "наличие в Москве" -> location: "Москва"
   - Локация может быть написана ЗАГЛАВНЫМИ БУКВАМИ - приводи к нормальному виду (первая заглавная, остальные строчные)
   - Локация может быть с точкой в конце - убирай точку
   - Локация может быть в начале сообщения отдельной строкой или в тексте
   - Примеры: "СОЛНЕЧНОГОРСК." -> "Солнечногорск", "МОСКВА" -> "Москва"
   - Извлекай ТОЛЬКО из сообщения! Если не указана -> ""

7. ПРИМЕЧАНИЯ:
   - "на гарантии,в идеале аппараты" -> notes: "на гарантии, в идеале аппараты"
   - "с ГТД РФ" -> notes: "ГТД РФ"
   - "С проверкой" -> notes: "С проверкой"

═══════════════════════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА:
═══════════════════════════════════════════════════════════════════════════════
{
  "operationType": "SELL" или "BUY",
  "location": "локация из сообщения или пустая строка",
  "products": [
    {
      "model": "модель из сообщения",
      "hashrate": "hashrate из сообщения или null",
      "manufacturer": "Bitmain, MicroBT, Innosilicon",
      "price": число или null,
      "currency": "USD, RUB, USDT или null",
      "quantity": число,
      "condition": null или "Б/У",
      "location": "локация из сообщения или пустая строка",
      "notes": "примечания из сообщения или пустая строка",
      "operationType": "SELL" или "BUY"
    }
  ]
}

═══════════════════════════════════════════════════════════════════════════════
ПРИМЕРЫ (ТОЛЬКО ДЛЯ СПРАВКИ - НЕ ИСПОЛЬЗУЙ ДЛЯ РЕАЛЬНОГО СООБЩЕНИЯ!):
═══════════════════════════════════════════════════════════════════════════════
"Куплю 20 шт \nAntminer j pro 104T\nПо 220 usdt" -> 
{"operationType": "BUY", "location": "", "products": [{"model": "S19j PRO", "hashrate": "104TH/s", "manufacturer": "Bitmain", "price": 220, "currency": "USDT", "quantity": 20, "condition": null, "location": "", "notes": "", "operationType": "BUY"}]}

"S21+ 235th \n2шт\nотправка из Брянска\nна гарантии,в идеале аппараты \n2550 usdt" -> 
{"operationType": "SELL", "location": "Брянск", "products": [{"model": "S21+", "hashrate": "235TH/s", "manufacturer": "Bitmain", "price": 2550, "currency": "USDT", "quantity": 2, "condition": null, "location": "Брянск", "notes": "на гарантии, в идеале аппараты", "operationType": "SELL"}]}

"СРОЧНО❗❗❗\nСОЛНЕЧНОГОРСК.\nСОСТОЯНИЕ НОВЫХ С ГТД.\nS21 XP 270TH \nЦена: 3800$" -> 
{"operationType": "SELL", "location": "Солнечногорск", "products": [{"model": "S21 XP", "hashrate": "270TH/s", "manufacturer": "Bitmain", "price": 3800, "currency": "USD", "quantity": 1, "condition": null, "location": "Солнечногорск", "notes": "СОСТОЯНИЕ НОВЫХ С ГТД, на гарантии", "operationType": "SELL"}]}

═══════════════════════════════════════════════════════════════════════════════
ВАЖНО - ПРАЙС-ЛИСТЫ:
═══════════════════════════════════════════════════════════════════════════════
Если сообщение содержит список товаров (прайс-лист):
- Каждая строка вида "🇷🇺L9 15G GTD $4600 — 380 420 ₽" = отдельный товар!
- Формат: "МОДЕЛЬ hashrate [модификация] [цена в USD] — [цена в RUB]"
- Извлекай ВСЕ товары из списка!
- Пример: "🇷🇺L9 15G GTD $4600 — 380 420 ₽" -> model: "L9", hashrate: "15GH/s", price: 4600, currency: "USD", quantity: 1
- Пример: "🇷🇺S21+235T GTDRB $2900 — 239 830 ₽" -> model: "S21+", hashrate: "235TH/s", price: 2900, currency: "USD", quantity: 1
- Пример: "🇷🇺L7 9500M $1950 — 161 265 ₽" -> model: "L7", hashrate: "9500MH/s", price: 1950, currency: "USD", quantity: 1

═══════════════════════════════════════════════════════════════════════════════
ВАЖНО: ИЗВЛЕКАЙ ДАННЫЕ ТОЛЬКО ИЗ СООБЩЕНИЯ ВЫШЕ!
═══════════════════════════════════════════════════════════════════════════════
- НЕ используй данные из примеров!
- Если в сообщении есть цена и НЕТ "Куплю"/"Ищу" -> это SELL!
- Если сообщение содержит список товаров -> верни ВСЕ товары в массиве products!
- ВАЖНО: Локация может быть написана ЗАГЛАВНЫМИ БУКВАМИ и с точкой в конце - обязательно извлекай её!
  Примеры: "СОЛНЕЧНОГОРСК." -> location: "Солнечногорск", "МОСКВА" -> location: "Москва"
  Локация часто находится в начале сообщения отдельной строкой (например, "СОЛНЕЧНОГОРСК.")
- Приводи локацию к нормальному виду: первая заглавная, остальные строчные, без точки
- Верни ТОЛЬКО JSON без комментариев!
${isReasoningModel ? '- НЕ пиши thinking/reasoning - только финальный JSON ответ!\n- НЕ используй рассуждения - сразу извлеки данные и верни JSON!\n' : ''}- Начни ответ сразу с { и закончи } - никакого текста до или после JSON!`;
  }

  /**
   * Извлекает распарсенные данные из ответа Ollama
   */
  extractParsedData(response, originalMessage) {
    try {
      // Проверяем, завершен ли запрос
      if (response.data && response.data.done === false) {
        logger.warn('⚠️  ВНИМАНИЕ: Запрос к Ollama не завершен (done: false)');
        logger.warn('⚠️  Возможно, модель не успела сгенерировать полный ответ');
        logger.warn('⚠️  Пытаемся извлечь данные из доступных полей...');
      }
      
      let responseText = '';
      
      // Сначала пытаемся получить response
      if (response.data && response.data.response) {
        responseText = String(response.data.response);
      }
      
      // Если response пустой, пробуем thinking (для моделей с reasoning)
      if (!responseText || responseText.trim() === '') {
        if (response.data && response.data.thinking) {
          logger.info('📝 Используем поле thinking для извлечения данных');
          responseText = String(response.data.thinking);
        }
      }
      
      // Если все еще пусто, используем весь объект
      if (!responseText || responseText.trim() === '') {
        if (typeof response.data === 'string') {
          responseText = response.data;
        } else {
          responseText = JSON.stringify(response.data);
        }
      }

      if (responseText.includes('"error"') || responseText.toLowerCase().includes('error')) {
        logger.error('❌ ОШИБКА В ОТВЕТЕ OLLAMA:', responseText);
        return null;
      }

      // Пытаемся найти JSON в ответе
      let jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          logger.info('✅ JSON успешно распарсен из ответа Ollama');
          return parsed;
        } catch (parseError) {
          logger.warn('⚠️  Ошибка парсинга JSON:', parseError.message);
          logger.warn('⚠️  Попытка найти JSON в thinking или других полях...');
          
          // Если есть thinking, пытаемся найти JSON там
          if (response.data && response.data.thinking) {
            const thinkingText = String(response.data.thinking);
            const thinkingJsonMatch = thinkingText.match(/\{[\s\S]*\}/);
            if (thinkingJsonMatch) {
              try {
                const parsed = JSON.parse(thinkingJsonMatch[0]);
                logger.info('✅ JSON успешно найден и распарсен из поля thinking');
                return parsed;
              } catch (e) {
                logger.warn('⚠️  Не удалось распарсить JSON из thinking:', e.message);
              }
            }
          }
        }
      }

      // Пытаемся исправить обрезанный JSON
      const lastBrace = responseText.lastIndexOf('}');
      if (lastBrace > 0) {
        const truncated = responseText.substring(0, lastBrace + 1);
        try {
          const parsed = JSON.parse(truncated);
          logger.info('✅ JSON успешно исправлен и распарсен');
          return parsed;
        } catch (e) {
          logger.warn('⚠️  Не удалось исправить JSON');
        }
      }

      logger.error('❌ Не удалось извлечь JSON из ответа Ollama');
      logger.error('Ответ:', responseText);
      return null;
    } catch (error) {
      logger.error('❌ Ошибка при извлечении данных:', error.message);
      return null;
    }
  }

  /**
   * Валидирует распарсенные данные от Ollama
   */
  validateParsedData(parsedData, originalMessage) {
    if (!parsedData || !parsedData.products || !Array.isArray(parsedData.products)) {
      return parsedData;
    }

    if (parsedData.products.length === 0) {
      return parsedData;
    }

    const knownModels = [
      'S19', 'S19 PRO', 'S19j', 'S19j PRO', 'S19j PRO+', 'S19k PRO', 'S19 XP', 'S21', 'S21+', 'S21 XP', 'S21e', 'S21 PRO', 'T21', 'L7', 'L9',
      'M30S', 'M30S+', 'M30S++', 'M50', 'M53', 'M56', 'M60', 'M60s+', 'M61s+', 'M63', 'M63s+', 'M63S',
      'AvalonMiner 1246', 'AvalonMiner 1166', 'AvalonMiner 1066',
      'T3+', 'T4',
      'M50', 'M53', 'M56', 'M60',
      'DG1', 'DG1+', 'DGhome', 'Z15', 'Z15 PRO', 'Z15e'
    ];

    const originalMessageLower = (originalMessage || '').toLowerCase();
    const validatedProducts = [];

    for (const product of parsedData.products) {
      const model = (product.model || '').trim();
      
      if (!model || model.length === 0) {
        logger.warn(`⚠️  Продукт без модели отброшен`);
        continue;
      }

      const modelNormalized = model.toUpperCase().replace(/\s+/g, '').trim();
      let isKnownModel = false;

      for (const known of knownModels) {
        const knownNormalized = known.toUpperCase().replace(/\s+/g, '').trim();
        if (knownNormalized === modelNormalized) {
          isKnownModel = true;
          break;
        }
      }

      if (isKnownModel) {
        validatedProducts.push(product);
      } else {
        logger.warn(`⚠️  Неизвестная модель "${model}" - проверяем наличие в сообщении`);
        const modelLower = model.toLowerCase().replace(/\s+/g, '');
        if (originalMessageLower.includes(modelLower)) {
          validatedProducts.push(product);
        } else {
          logger.warn(`⚠️  Модель "${model}" не найдена в оригинальном сообщении - отброшена`);
        }
      }
    }

    if (validatedProducts.length === 0) {
      logger.warn('⚠️  После валидации не осталось ни одного продукта');
      return { operationType: parsedData.operationType || 'SELL', location: parsedData.location || '', products: [] };
    }

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
