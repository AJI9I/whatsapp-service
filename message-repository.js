import { query } from './database.js';
import { logger } from './logger.js';

/**
 * Репозиторий для работы с сообщениями в PostgreSQL
 */
export class MessageRepository {
  /**
   * Сохраняет новое сообщение
   */
  async saveMessage(messageData) {
    const result = await query(
      `INSERT INTO whatsapp_messages (
        whatsapp_message_id, chat_id, chat_name, chat_type,
        sender_id, sender_name, sender_phone_number,
        content, status, has_media, message_type, is_forwarded, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, created_at`,
      [
        messageData.whatsappMessageId,
        messageData.chatId,
        messageData.chatName,
        messageData.chatType,
        messageData.senderId,
        messageData.senderName,
        messageData.senderPhoneNumber,
        messageData.content,
        'received', // Статус по умолчанию
        messageData.hasMedia || false,
        messageData.messageType || 'chat',
        messageData.isForwarded || false,
        messageData.timestamp || new Date()
      ]
    );

    return result.rows[0];
  }

  /**
   * Обновляет статус сообщения
   */
  async updateStatus(messageId, status, ollamaTaskId = null, promptId = null) {
    const updates = ['status = $2'];
    const params = [messageId, status];
    let paramIndex = 3;

    if (ollamaTaskId !== null) {
      updates.push(`ollama_task_id = $${paramIndex}`);
      params.push(ollamaTaskId);
      paramIndex++;
    }

    if (promptId !== null) {
      updates.push(`prompt_id = $${paramIndex}`);
      params.push(promptId);
      paramIndex++;
    }

    await query(
      `UPDATE whatsapp_messages 
       SET ${updates.join(', ')}
       WHERE id = $1`,
      params
    );
  }

  /**
   * Обновляет результат парсинга
   */
  async updateParsedData(messageId, parsedData, errorMessage = null) {
    await query(
      `UPDATE whatsapp_messages 
       SET parsed_data = $2,
           error_message = $3,
           status = CASE 
             WHEN $3 IS NOT NULL THEN 'failed'
             ELSE 'completed'
           END
       WHERE id = $1`,
      [messageId, JSON.stringify(parsedData), errorMessage]
    );
  }

  /**
   * Получает сообщение по ID
   */
  async getMessageById(messageId) {
    const result = await query(
      `SELECT * FROM whatsapp_messages WHERE id = $1`,
      [messageId]
    );

    return result.rows[0] || null;
  }

  /**
   * Получает сообщение по WhatsApp message ID
   */
  async getMessageByWhatsAppId(whatsappMessageId) {
    const result = await query(
      `SELECT * FROM whatsapp_messages WHERE whatsapp_message_id = $1`,
      [whatsappMessageId]
    );

    return result.rows[0] || null;
  }

  /**
   * Получает сообщения по статусу
   */
  async getMessagesByStatus(status, limit = 100) {
    const result = await query(
      `SELECT * FROM whatsapp_messages 
       WHERE status = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [status, limit]
    );

    return result.rows;
  }

  /**
   * Обновляет статус сообщения по whatsapp_message_id или id из БД (совместимость с существующим кодом)
   * @param {number|string} whatsappMessageIdOrDbId - ID сообщения (может быть как whatsapp_message_id, так и id из БД)
   * @param {string} status - Новый статус
   * @param {Object} options - Дополнительные опции (error, ollamaTaskId и т.д.)
   */
  async updateMessageStatus(whatsappMessageIdOrDbId, status, options = {}) {
    // Определяем, что передано: ID из БД или whatsapp_message_id
    // Если это строка или содержит символы "@", "_" или начинается с "test_", это whatsapp_message_id
    // Иначе - это ID из БД (число)
    const isWhatsAppId = typeof whatsappMessageIdOrDbId === 'string' || 
                         String(whatsappMessageIdOrDbId).includes('@') ||
                         String(whatsappMessageIdOrDbId).includes('_') ||
                         String(whatsappMessageIdOrDbId).startsWith('test_');
    
    const whereClause = isWhatsAppId ? 'whatsapp_message_id = $1' : 'id = $1';
    
    const updates = ['status = $2'];
    const params = [whatsappMessageIdOrDbId, status];
    let paramIndex = 3;

    if (options.ollamaTaskId !== undefined && options.ollamaTaskId !== null) {
      updates.push(`ollama_task_id = $${paramIndex}`);
      params.push(options.ollamaTaskId);
      paramIndex++;
    }

    if (options.promptId !== undefined && options.promptId !== null) {
      updates.push(`prompt_id = $${paramIndex}`);
      params.push(options.promptId);
      paramIndex++;
    }

    if (options.error !== undefined && options.error !== null) {
      updates.push(`error_message = $${paramIndex}`);
      params.push(typeof options.error === 'string' ? options.error : JSON.stringify(options.error));
      paramIndex++;
    }

    await query(
      `UPDATE whatsapp_messages 
       SET ${updates.join(', ')}
       WHERE ${whereClause}`,
      params
    );
  }

  /**
   * Обновляет данные парсинга сообщения по whatsapp_message_id или id из БД (совместимость с существующим кодом)
   * @param {number|string} whatsappMessageIdOrDbId - ID сообщения (может быть как whatsapp_message_id, так и id из БД)
   * @param {Object} parsedData - Распарсенные данные
   */
  async updateMessageParsedData(whatsappMessageIdOrDbId, parsedData) {
    // Определяем, что передано: ID из БД или whatsapp_message_id
    const isWhatsAppId = typeof whatsappMessageIdOrDbId === 'string' || 
                         String(whatsappMessageIdOrDbId).includes('@') ||
                         String(whatsappMessageIdOrDbId).includes('_') ||
                         String(whatsappMessageIdOrDbId).startsWith('test_');
    
    const whereClause = isWhatsAppId ? 'whatsapp_message_id = $1' : 'id = $1';
    
    await query(
      `UPDATE whatsapp_messages 
       SET parsed_data = $2,
           status = 'processed'
       WHERE ${whereClause}`,
      [whatsappMessageIdOrDbId, JSON.stringify(parsedData)]
    );
  }

  /**
   * Находит дубликаты сообщений от отправителя с идентичным содержимым
   * за последние 10 минут в других чатах (исключая текущий чат)
   * @param {string} senderPhoneNumber - номер телефона отправителя
   * @param {string} content - содержимое сообщения
   * @param {string} currentChatId - ID текущего чата (будет исключен)
   * @param {Date} currentTimestamp - время текущего сообщения
   * @returns {Promise<Array>} массив найденных дубликатов
   */
  async findDuplicateMessages(senderPhoneNumber, content, currentChatId, currentTimestamp) {
    if (!senderPhoneNumber || !content || !currentChatId || !currentTimestamp) {
      return [];
    }

    // Вычисляем время 10 минут назад
    const tenMinutesAgo = new Date(currentTimestamp.getTime() - 10 * 60 * 1000);

    const result = await query(
      `SELECT id, whatsapp_message_id, chat_id, chat_name, sender_phone_number, 
              content, timestamp, duplicate_count
       FROM whatsapp_messages
       WHERE sender_phone_number = $1
         AND content = $2
         AND timestamp >= $3
         AND chat_id != $4
       ORDER BY timestamp DESC
       LIMIT 10`,
      [senderPhoneNumber, content, tenMinutesAgo, currentChatId]
    );

    return result.rows;
  }

  /**
   * Увеличивает счетчик дубликатов у сообщения
   * @param {number} messageId - ID сообщения в БД
   * @returns {Promise<void>}
   */
  async incrementDuplicateCount(messageId) {
    await query(
      `UPDATE whatsapp_messages 
       SET duplicate_count = COALESCE(duplicate_count, 0) + 1
       WHERE id = $1`,
      [messageId]
    );
  }
}

export const messageRepository = new MessageRepository();

