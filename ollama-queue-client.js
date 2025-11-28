import { logger } from './logger.js';
import { createOllamaClient } from './ollama-client.js';

/**
 * Клиент Ollama с очередью и контролем выполнения
 * Управляет параллельными запросами, retry при ошибках и собирает метрики
 */
export class OllamaQueueClient {
  constructor(ollamaUrl = 'http://localhost:11434', model = null) {
    // Создаем низкоуровневый клиент Ollama
    this.ollamaClient = createOllamaClient(ollamaUrl, model);
    
    // Настройки очереди
    this.concurrency = parseInt(process.env.OLLAMA_QUEUE_CONCURRENCY || '2'); // Количество параллельных запросов
    this.retryAttempts = parseInt(process.env.OLLAMA_QUEUE_RETRY_ATTEMPTS || '3'); // Количество попыток при ошибке
    this.retryDelay = parseInt(process.env.OLLAMA_QUEUE_RETRY_DELAY || '5000'); // Задержка между попытками (мс)
    this.taskTimeout = parseInt(process.env.OLLAMA_QUEUE_TIMEOUT || '600000'); // Таймаут задачи в очереди (мс)
    
    // Очередь задач
    this.queue = [];
    this.activeTasks = new Map(); // Активные задачи (id -> task объект)
    this.taskIdCounter = 0;
    
    // Метрики
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      averageWaitTime: 0,
      averageProcessTime: 0,
      waitTimes: [],
      processTimes: []
    };
    
    // Флаг работы обработчика очереди
    this.isProcessing = false;
    
    logger.info('📦 OllamaQueueClient инициализирован');
    logger.info(`   Concurrency: ${this.concurrency}`);
    logger.info(`   Retry attempts: ${this.retryAttempts}`);
    logger.info(`   Retry delay: ${this.retryDelay}ms`);
    logger.info(`   Task timeout: ${this.taskTimeout}ms`);
    
    // Запускаем обработчик очереди
    this.startQueueProcessor();
  }
  
  /**
   * Запускает обработчик очереди
   */
  startQueueProcessor() {
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;
    this.processQueue();
  }
  
  /**
   * Обрабатывает очередь задач
   */
  async processQueue() {
    while (this.isProcessing) {
      // Проверяем, можем ли запустить новую задачу
      if (this.activeTasks.size < this.concurrency && this.queue.length > 0) {
        const task = this.queue.shift();
        this.executeTask(task);
      } else {
        // Если очередь пуста и нет активных задач, делаем небольшую паузу
        if (this.queue.length === 0 && this.activeTasks.size === 0) {
          await this.sleep(100);
        } else {
          // Если есть задачи в очереди, но достигнут лимит параллелизма, ждем
          await this.sleep(50);
        }
      }
    }
  }
  
  /**
   * Выполняет задачу
   */
  async executeTask(task) {
    const taskId = task.id;
    const startTime = Date.now();
    
    // Добавляем в активные задачи
    this.activeTasks.set(taskId, task);
    
    // Вычисляем время ожидания в очереди
    const waitTime = startTime - task.enqueuedAt;
    this.stats.waitTimes.push(waitTime);
    
    // Обновляем среднее время ожидания (храним только последние 100 значений)
    if (this.stats.waitTimes.length > 100) {
      this.stats.waitTimes.shift();
    }
    this.stats.averageWaitTime = this.stats.waitTimes.reduce((a, b) => a + b, 0) / this.stats.waitTimes.length;
    
    logger.debug(`🔄 Начало выполнения задачи #${taskId} (ожидание в очереди: ${waitTime}ms)`);
    
    try {
      // Создаем таймаут для задачи
      const timeoutPromise = this.createTimeout(taskId);
      
      // Выполняем задачу с таймаутом
      const result = await Promise.race([
        this.executeWithRetry(task),
        timeoutPromise
      ]);
      
      // Удаляем таймаут, если задача завершилась успешно
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
        task.timeoutId = null;
      }
      
      const processTime = Date.now() - startTime;
      this.stats.processTimes.push(processTime);
      
      // Обновляем среднее время обработки (храним только последние 100 значений)
      if (this.stats.processTimes.length > 100) {
        this.stats.processTimes.shift();
      }
      this.stats.averageProcessTime = this.stats.processTimes.reduce((a, b) => a + b, 0) / this.stats.processTimes.length;
      
      this.stats.completedTasks++;
      logger.debug(`✅ Задача #${taskId} завершена успешно (время обработки: ${processTime}ms)`);
      
      // Резолвим промис задачи
      task.resolve(result);
      
    } catch (error) {
      const processTime = Date.now() - startTime;
      this.stats.failedTasks++;
      logger.error(`❌ Задача #${taskId} завершена с ошибкой (время обработки: ${processTime}ms): ${error.message}`);
      
      // Реджектим промис задачи
      task.reject(error);
      
    } finally {
    // Удаляем из активных задач
    this.activeTasks.delete(taskId);
    
    // Отменяем таймаут, если он был установлен
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }
    }
  }
  
  /**
   * Выполняет задачу с retry механизмом
   */
  async executeWithRetry(task) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        if (attempt > 1) {
          this.stats.retriedTasks++;
          const delay = this.retryDelay * (attempt - 1); // Увеличиваем задержку с каждой попыткой
          logger.warn(`🔄 Повторная попытка задачи #${task.id} (попытка ${attempt}/${this.retryAttempts}, задержка ${delay}ms)`);
          await this.sleep(delay);
        }
        
        // Выполняем запрос к Ollama
        const result = await this.ollamaClient.parseMessage(
          task.messageContent,
          task.logOllamaResponse
        );
        
        return result;
        
      } catch (error) {
        lastError = error;
        logger.warn(`⚠️  Попытка ${attempt}/${this.retryAttempts} задачи #${task.id} не удалась: ${error.message}`);
        
        // Если это последняя попытка, пробрасываем ошибку
        if (attempt === this.retryAttempts) {
          throw error;
        }
      }
    }
    
    // Не должно сюда дойти, но на всякий случай
    throw lastError || new Error('Неизвестная ошибка при выполнении задачи');
  }
  
  /**
   * Создает таймаут для задачи
   */
  createTimeout(taskId) {
    return new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Таймаут задачи #${taskId} (${this.taskTimeout}ms)`));
      }, this.taskTimeout);
      
      // Сохраняем ID таймаута в задаче для возможности отмены
      const task = this.activeTasks.get(taskId);
      if (task) {
        task.timeoutId = timeoutId;
      }
    });
  }
  
  /**
   * Добавляет задачу в очередь
   */
  async parseMessage(messageContent, logOllamaResponse = true) {
    // Проверяем входные данные
    if (!messageContent || typeof messageContent !== 'string' || messageContent.trim().length === 0) {
      logger.error('❌ Пустое сообщение для парсинга');
      return null;
    }
    
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskIdCounter;
      const task = {
        id: taskId,
        messageContent,
        logOllamaResponse,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        timeoutId: null
      };
      
      this.queue.push(task);
      this.stats.totalTasks++;
      
      const queueSize = this.queue.length;
      const activeCount = this.activeTasks.size;
      
      logger.debug(`📥 Задача #${taskId} добавлена в очередь (размер очереди: ${queueSize}, активных: ${activeCount})`);
      
      // Если очередь была пуста и нет активных задач, запускаем обработчик
      if (!this.isProcessing) {
        this.startQueueProcessor();
      }
    });
  }
  
  /**
   * Получает статистику очереди
   */
  getStats() {
    return {
      queueSize: this.queue.length,
      activeTasks: this.activeTasks.size,
      concurrency: this.concurrency,
      stats: {
        ...this.stats,
        averageWaitTime: Math.round(this.stats.averageWaitTime),
        averageProcessTime: Math.round(this.stats.averageProcessTime)
      }
    };
  }
  
  /**
   * Очищает статистику
   */
  clearStats() {
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      averageWaitTime: 0,
      averageProcessTime: 0,
      waitTimes: [],
      processTimes: []
    };
    logger.info('📊 Статистика очереди очищена');
  }
  
  /**
   * Утилита для задержки
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Останавливает обработчик очереди
   */
  stop() {
    this.isProcessing = false;
    logger.info('🛑 Обработчик очереди остановлен');
  }
}

/**
 * Создает экземпляр OllamaQueueClient
 */
export function createOllamaQueueClient(ollamaUrl, model) {
  return new OllamaQueueClient(ollamaUrl, model);
}

