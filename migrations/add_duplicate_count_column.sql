-- Миграция: Добавление колонки duplicate_count в таблицу whatsapp_messages
-- Дата: 2025-12-01
-- Описание: Добавляет колонку для подсчета дубликатов сообщений от одного отправителя в разных группах за последние 10 минут

-- Проверяем, существует ли колонка, и добавляем её, если её нет
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'whatsapp_messages' 
        AND column_name = 'duplicate_count'
    ) THEN
        -- Добавляем колонку с значением по умолчанию
        ALTER TABLE whatsapp_messages 
        ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0;
        
        -- Обновляем все существующие записи (на всякий случай)
        UPDATE whatsapp_messages SET duplicate_count = 0 WHERE duplicate_count IS NULL;
        
        -- Комментарий к колонке
        COMMENT ON COLUMN whatsapp_messages.duplicate_count IS 
        'Счетчик дубликатов - количество раз, когда от этого отправителя было получено идентичное сообщение в других группах за последние 10 минут';
        
        RAISE NOTICE 'Колонка duplicate_count успешно добавлена в таблицу whatsapp_messages';
    ELSE
        RAISE NOTICE 'Колонка duplicate_count уже существует в таблице whatsapp_messages';
    END IF;
END $$;

