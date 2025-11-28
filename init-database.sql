-- SQL скрипт для создания базы данных whatsapp_service
-- Выполните этот скрипт от имени пользователя postgres или суперпользователя
-- 
-- Использование:
-- psql -U postgres -f whatsapp-service/init-database.sql

-- Создаем базу данных (если её нет)
CREATE DATABASE whatsapp_service
    WITH 
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'Russian_Russia.1251'
    LC_CTYPE = 'Russian_Russia.1251'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1;

-- Комментарий к базе данных
COMMENT ON DATABASE whatsapp_service IS 'База данных для WhatsApp Service - хранение сообщений и статусов обработки';

-- Подключаемся к созданной базе данных
\c whatsapp_service

-- Таблица для сообщений из WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id SERIAL PRIMARY KEY,
  whatsapp_message_id VARCHAR(255) NOT NULL, -- ID сообщения из WhatsApp Web.js
  chat_id VARCHAR(255) NOT NULL,
  chat_name VARCHAR(255),
  chat_type VARCHAR(20) NOT NULL, -- 'group' или 'personal'
  sender_id VARCHAR(255) NOT NULL,
  sender_name VARCHAR(255),
  sender_phone_number VARCHAR(50),
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received', -- received, sent_to_ollama, processing, completed, failed
  ollama_task_id INTEGER, -- ID задачи в Ollama Service
  prompt_id INTEGER, -- ID промпта, который использовался
  parsed_data JSONB, -- Результат парсинга от Ollama
  error_message TEXT, -- Сообщение об ошибке, если есть
  has_media BOOLEAN DEFAULT false,
  message_type VARCHAR(50),
  is_forwarded BOOLEAN DEFAULT false,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для таблицы сообщений
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id ON whatsapp_messages(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_ollama_task ON whatsapp_messages(ollama_task_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_id ON whatsapp_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);

-- Комментарии к таблице
COMMENT ON TABLE whatsapp_messages IS 'Сообщения из WhatsApp с метаданными и статусами обработки';
COMMENT ON COLUMN whatsapp_messages.status IS 'Статус: received - получено, sent_to_ollama - отправлено в Ollama, processing - обрабатывается, completed - завершено, failed - ошибка';
COMMENT ON COLUMN whatsapp_messages.ollama_task_id IS 'ID задачи в Ollama Service для связи между сервисами';

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_whatsapp_messages_updated_at ON whatsapp_messages;
CREATE TRIGGER update_whatsapp_messages_updated_at
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Выводим информацию о созданных таблицах
SELECT 'База данных whatsapp_service успешно создана и настроена!' AS message;
SELECT 'Таблицы:' AS info;
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'whatsapp%';

