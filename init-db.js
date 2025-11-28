import 'dotenv/config';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initDatabase, initSchema } from './database.js';
// Простой логгер для init-db.js (без зависимостей)
const logger = {
  info: (msg) => console.log(msg),
  error: (msg) => console.error(msg),
  warn: (msg) => console.warn(msg),
  debug: (msg) => console.log(msg)
};

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Скрипт для инициализации базы данных WhatsApp Service
 */
async function setupDatabase() {
  const adminConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres', // Подключаемся к postgres для создания БД
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'vasagaroot',
  };

  const pool = new Pool(adminConfig);

  try {
    logger.info('🔌 Подключение к PostgreSQL...');
    
    // Проверяем подключение
    await pool.query('SELECT NOW()');
    logger.info('✅ Подключение установлено');

    // Проверяем, существует ли БД
    const dbName = process.env.DB_NAME || 'whatsapp_service';
    const dbCheck = await pool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (dbCheck.rows.length === 0) {
      logger.info(`📦 Создание базы данных ${dbName}...`);
      await pool.query(`CREATE DATABASE ${dbName}`);
      logger.info(`✅ База данных ${dbName} создана`);
    } else {
      logger.info(`ℹ️  База данных ${dbName} уже существует`);
    }

    // Подключаемся к созданной БД
    await pool.end();
    
    const dbConfig = {
      ...adminConfig,
      database: dbName
    };

    const dbPool = new Pool(dbConfig);
    
    // Используем initSchema из database.js для правильной обработки SQL
    logger.info('📋 Создание схемы базы данных...');
    
    await dbPool.end();
    
    // Инициализируем подключение к созданной БД
    await initDatabase();
    
    // Создаем схему (таблицы, индексы, триггеры)
    await initSchema();
    
    logger.info('✅ База данных инициализирована успешно');
    
  } catch (error) {
    logger.error('❌ Ошибка инициализации базы данных:', error.message);
    if (error.stack) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

// Запускаем инициализацию
setupDatabase();

