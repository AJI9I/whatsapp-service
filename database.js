import pg from 'pg';
import { logger } from './logger.js';

const { Pool } = pg;

/**
 * Пул соединений с PostgreSQL для WhatsApp Service
 */
let pool = null;

/**
 * Инициализирует подключение к PostgreSQL
 */
export async function initDatabase() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'whatsapp_service',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'vasagaroot',
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'),
  };

  pool = new Pool(config);

  // Обработка ошибок пула
  pool.on('error', (err) => {
    logger.error('❌ Неожиданная ошибка пула PostgreSQL:', err);
  });

  // Проверка подключения
  try {
    await pool.query('SELECT NOW()');
    logger.info('✅ Подключение к PostgreSQL установлено (WhatsApp Service)');
    logger.info(`   База данных: ${config.database}`);
    logger.info(`   Хост: ${config.host}:${config.port}`);
    return pool;
  } catch (err) {
    logger.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    throw err;
  }
}

/**
 * Получает пул соединений
 */
export function getPool() {
  if (!pool) {
    throw new Error('База данных не инициализирована. Вызовите initDatabase() сначала.');
  }
  return pool;
}

/**
 * Закрывает все соединения
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    logger.info('🔌 Соединения с PostgreSQL закрыты (WhatsApp Service)');
  }
}

/**
 * Выполняет SQL запрос
 */
export async function query(text, params) {
  const pool = getPool();
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    logger.error(`❌ Ошибка выполнения SQL запроса: ${error.message}`);
    logger.error(`   Запрос: ${text.substring(0, 200)}...`);
    if (params) {
      logger.error(`   Параметры: ${JSON.stringify(params)}`);
    }
    throw error;
  }
}

/**
 * Инициализирует схему БД (создает таблицы, если их нет)
 */
export async function initSchema() {
  const createTablesSQL = `
    -- Таблица для сообщений из WhatsApp
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id SERIAL PRIMARY KEY,
      whatsapp_message_id VARCHAR(255) NOT NULL,
      chat_id VARCHAR(255) NOT NULL,
      chat_name VARCHAR(255),
      chat_type VARCHAR(20) NOT NULL,
      sender_id VARCHAR(255) NOT NULL,
      sender_name VARCHAR(255),
      sender_phone_number VARCHAR(50),
      content TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'received',
      ollama_task_id INTEGER,
      prompt_id INTEGER,
      parsed_data JSONB,
      error_message TEXT,
      has_media BOOLEAN DEFAULT false,
      message_type VARCHAR(50),
      is_forwarded BOOLEAN DEFAULT false,
      timestamp TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Индексы
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(status);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id ON whatsapp_messages(whatsapp_message_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_ollama_task ON whatsapp_messages(ollama_task_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_id ON whatsapp_messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);

    -- Функция для автоматического обновления updated_at
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ language 'plpgsql';

    -- Триггер
    DROP TRIGGER IF EXISTS update_whatsapp_messages_updated_at ON whatsapp_messages;
    CREATE TRIGGER update_whatsapp_messages_updated_at
      BEFORE UPDATE ON whatsapp_messages
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `;

  try {
    await query(createTablesSQL);
    logger.info('✅ Схема базы данных инициализирована (WhatsApp Service)');
    
    // Добавляем колонку duplicate_count, если её нет (миграция)
    await addDuplicateCountColumn();
  } catch (error) {
    logger.error('❌ Ошибка инициализации схемы БД:', error.message);
    throw error;
  }
}

/**
 * Добавляет колонку duplicate_count в таблицу whatsapp_messages (миграция)
 */
async function addDuplicateCountColumn() {
  const migrationSQL = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'whatsapp_messages' 
        AND column_name = 'duplicate_count'
      ) THEN
        ALTER TABLE whatsapp_messages 
        ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0;
        
        COMMENT ON COLUMN whatsapp_messages.duplicate_count IS 
        'Счетчик дубликатов - количество раз, когда от этого отправителя было получено идентичное сообщение в других группах за последние 10 минут';
        
        RAISE NOTICE 'Колонка duplicate_count успешно добавлена в таблицу whatsapp_messages';
      END IF;
    END $$;
  `;

  try {
    await query(migrationSQL);
    logger.info('✅ Миграция: проверка колонки duplicate_count выполнена');
  } catch (error) {
    logger.warn('⚠️  Ошибка при добавлении колонки duplicate_count (возможно, уже существует):', error.message);
    // Не прерываем выполнение, если колонка уже существует
  }
}

