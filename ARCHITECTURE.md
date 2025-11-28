# Архитектура WhatsApp Service

## Обзор

WhatsApp Service - это Node.js сервис для мониторинга групповых чатов и личных сообщений WhatsApp с автоматической обработкой сообщений через LLM (Ollama) и отправкой результатов в Spring Boot API.

## Дата создания документации: 2025-01-28

---

## Архитектура системы

### Основные компоненты

1. **WhatsApp Client** (`whatsapp-client.js`)
   - Управление подключением к WhatsApp Web
   - Обработка QR-кода для авторизации
   - Управление сессией (LocalAuth)
   - Отслеживание статуса подключения

2. **Message Handler** (`message-handler.js`)
   - Обработка входящих сообщений
   - Фильтрация по мониторингу групп/чатов
   - Интеграция с Ollama Service для парсинга
   - Сохранение сообщений в БД
   - Отправка результатов в Spring Boot API

3. **Web Server** (`web-server.js`)
   - Express веб-сервер
   - REST API endpoints
   - Веб-интерфейс управления
   - Статические файлы

4. **API Client** (`api-client.js`)
   - Отправка данных в Spring Boot API
   - Retry логика при ошибках
   - Поддержка множественных API endpoints

5. **Config Manager** (`config-manager.js`)
   - Управление конфигурацией мониторинга
   - Сохранение/загрузка из `monitoring-config.json`
   - Настройки API, групп, личных чатов

6. **Database** (`database.js`, `message-repository.js`)
   - PostgreSQL/H2 база данных
   - Хранение сообщений
   - Хранение результатов парсинга

7. **Ollama Integration** (`ollama-service-client.js`, `ollama-queue-client.js`)
   - Интеграция с Ollama Service
   - Очередь запросов на парсинг
   - Обработка результатов парсинга

---

## Поток обработки сообщений

### 1. Получение сообщения от WhatsApp

```
WhatsApp Web → whatsapp-client.js → message-handler.js
```

- WhatsApp клиент получает сообщение через событие `message`
- Сообщение передается в `handleMessage()` в `message-handler.js`

### 2. Логирование и фильтрация

```
handleMessage() → 
  - Логирование сырого сообщения в smgIN.txt
  - Проверка мониторинга (группа/личный чат)
  - Сохранение в БД через messageRepository
```

### 3. Парсинг через Ollama Service

```
handleMessage() → 
  - Проверка активных заданий (tasks-manager.js)
  - Отправка в Ollama Service через ollama-service-client.js
  - Ожидание результата парсинга
```

### 4. Обработка результата парсинга

```
Webhook от Ollama Service → 
  /api/webhook/ollama-result →
    - Обновление статуса в БД
    - Сохранение parsed_data
    - Отправка в Spring Boot API через api-client.js
```

### 5. Отправка в Spring Boot API

```
api-client.js → 
  - Формирование JSON данных
  - Отправка POST запроса
  - Retry при ошибках
  - Логирование результата
```

---

## API Endpoints

### Веб-интерфейс

- `GET /` - Главная страница
- `GET /chats` - Страница управления чатами
- `GET /messages` - Страница сообщений
- `GET /logs` - Страница логов
- `GET /restore-contacts` - Страница восстановления контактов

### API Endpoints

#### Статус и управление

- `GET /api/status` - Получить статус WhatsApp клиента
- `GET /api/qrcode` - Получить QR-код (если доступен)
- `POST /api/reconnect` - Переподключить WhatsApp клиент

#### Чаты и контакты

- `GET /api/chats` - Получить список чатов (группы и личные)
- `GET /api/chats/:chatId/participants` - Получить участников группы
- `GET /api/find-contact/:contactId` - Найти контакт в группах

#### Конфигурация

- `GET /api/config` - Получить конфигурацию мониторинга
- `POST /api/config/api` - Обновить настройки API
- `POST /api/config/groups` - Обновить список мониторинга групп
- `POST /api/config/personal` - Обновить список мониторинга личных чатов
- `POST /api/config/logging` - Обновить настройки логирования

#### Задания (Tasks)

- `GET /api/tasks` - Получить список заданий
- `POST /api/tasks` - Создать задание
- `PUT /api/tasks/:id` - Обновить задание
- `DELETE /api/tasks/:id` - Удалить задание

#### Промпты

- `GET /api/prompts` - Получить список промптов из Ollama Service

#### Тестирование

- `POST /api/test-message` - Отправить тестовое сообщение

#### Логи

- `GET /api/logs` - Получить логи
- `POST /api/logs/clear` - Очистить логи

#### Восстановление контактов

- `POST /api/restore-contacts` - Запустить восстановление контактов
- `GET /api/restore-contacts/logs` - Получить логи восстановления
- `POST /api/restore-contacts/logs/clear` - Очистить логи восстановления
- `GET /api/restore-contacts/offers` - Получить список предложений для восстановления
- `GET /api/restore-contacts/test-methods` - Тестирование методов получения номера
- `POST /api/restore-contacts/test-methods` - Тестирование методов получения номера
- `POST /api/restore-contacts/offers/:id` - Восстановить одно предложение

#### Товары

- `GET /api/products` - Получить список товаров из буфера
- `POST /api/products/clear` - Очистить буфер товаров

#### Webhooks

- `POST /api/webhook/ollama-result` - Webhook для получения результатов от Ollama Service

---

## WhatsApp Client API

### Экспортируемые функции из `whatsapp-client.js`:

1. **`createClient(sessionPath)`**
   - Создает новый экземпляр WhatsApp клиента
   - Настраивает LocalAuth для сохранения сессии
   - Регистрирует обработчики событий

2. **`initializeClient(sessionPath)`**
   - Инициализирует клиент (вызывает `client.initialize()`)
   - Обрабатывает QR-код, аутентификацию, готовность

3. **`getClientStatus()`**
   - Возвращает текущий статус клиента
   - Формат: `{ status, qrCode, isReady, isConnected }`

4. **`getClient()`**
   - Возвращает экземпляр клиента (для прямого доступа к API whatsapp-web.js)

5. **`destroyClient()`**
   - Уничтожает клиент и очищает состояние

### Методы WhatsApp Client (через `getClient()`)

Клиент использует библиотеку `whatsapp-web.js`, которая предоставляет следующие основные методы:

- `client.sendMessage(chatId, content)` - Отправить текстовое сообщение
- `client.getChats()` - Получить список чатов
- `client.getChatById(chatId)` - Получить чат по ID
- `client.getContacts()` - Получить список контактов
- `client.getContactById(contactId)` - Получить контакт по ID
- `client.getState()` - Получить состояние клиента
- `client.info` - Информация о клиенте (pushname, wid и т.д.)

---

## База данных

### Таблицы

1. **messages**
   - Хранение всех входящих сообщений
   - Поля: id, whatsapp_message_id, chat_id, chat_name, sender_id, sender_name, sender_phone_number, content, timestamp, has_media, message_type, is_forwarded, status, parsed_data

2. **prompts** (в Ollama Service)
   - Хранение промптов для парсинга

3. **queue** (в Ollama Service)
   - Очередь запросов на парсинг

---

## Конфигурация

### Файлы конфигурации

1. **`.env`** - Переменные окружения
   - `API_URL` - URL Spring Boot API
   - `API_ENDPOINT` - Endpoint для webhook
   - `API_KEY` - API ключ (опционально)
   - `SESSION_PATH` - Путь для сохранения сессии
   - `WEB_PORT` - Порт веб-сервера
   - `LOG_LEVEL` - Уровень логирования
   - `OLLAMA_SERVICE_URL` - URL Ollama Service
   - `OLLAMA_URL` - URL Ollama
   - `OLLAMA_MODEL` - Модель Ollama

2. **`monitoring-config.json`** - Конфигурация мониторинга
   - Настройки API
   - Список мониторинга групп
   - Список мониторинга личных чатов
   - Настройки логирования

---

## Логирование

### Файлы логов

- `logs/combined.log` - Все логи
- `logs/error.log` - Только ошибки
- `logs/messages/incoming-YYYY-MM-DD.txt` - Входящие сообщения
- `logs/messages/sent-YYYY-MM-DD.txt` - Отправленные сообщения
- `smgIN.txt` - Сырые входящие сообщения (JSON)

### Уровни логирования

- `error` - Только ошибки
- `warn` - Предупреждения и ошибки
- `info` - Информация, предупреждения и ошибки
- `debug` - Детальная информация для отладки

---

## Интеграция с Ollama Service

### Поток запроса на парсинг

1. Сообщение получается и сохраняется в БД
2. Проверяются активные задания для чата
3. Запрос отправляется в Ollama Service через `ollama-service-client.js`
4. Ollama Service обрабатывает запрос и возвращает результат
5. Результат приходит через webhook `/api/webhook/ollama-result`
6. Данные сохраняются в БД и отправляются в Spring Boot API

### Формат запроса в Ollama Service

```json
{
  "whatsapp_message_id": "123",
  "content": "Текст сообщения",
  "chat_id": "120363123456789@g.us",
  "chat_name": "Название группы",
  "sender_id": "5511999999999@c.us",
  "sender_name": "Имя отправителя",
  "sender_phone_number": "5511999999999",
  "prompt_id": 1,
  "callback_url": "http://localhost:3000/api/webhook/ollama-result"
}
```

### Формат ответа от Ollama Service

```json
{
  "whatsapp_message_id": "123",
  "task_id": "456",
  "status": "success",
  "parsed_data": {
    "isMiningEquipment": true,
    "operationType": "sale",
    "location": "Москва",
    "products": [...]
  },
  "error": null
}
```

---

## Интеграция с Spring Boot API

### Формат данных для отправки

```json
{
  "messageId": "whatsapp_123_0",
  "chatId": "120363123456789@g.us",
  "chatName": "Продажа ASIC майнеров",
  "senderId": "5511999999999@c.us",
  "senderName": "Иван Петров",
  "senderPhoneNumber": "5511999999999",
  "content": "Текст сообщения",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "hasMedia": false,
  "messageType": "chat",
  "isForwarded": false,
  "parsedData": {
    "isMiningEquipment": true,
    "operationType": "sale",
    "location": "Москва",
    "products": [...]
  }
}
```

### Retry логика

- Количество попыток: `config.retryAttempts` (по умолчанию 3)
- Задержка между попытками: `config.retryDelay` (по умолчанию 5000 мс)

---

## Задания (Tasks)

Система заданий позволяет автоматически обрабатывать сообщения из определенных чатов с определенными промптами.

### Структура задания

```json
{
  "id": 1,
  "name": "Обработка продаж",
  "promptId": 1,
  "chatIds": ["120363123456789@g.us"],
  "enabled": true,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### Логика работы

- При получении сообщения проверяются активные задания для чата
- Если найдено задание, сообщение отправляется в Ollama Service с указанным `promptId`
- Результат обрабатывается через webhook

---

## Безопасность

- Сессия WhatsApp сохраняется локально в `.wwebjs_auth/`
- API ключ для Spring Boot API (опционально)
- Веб-интерфейс доступен только локально (порт 3000)
- Нет авторизации для веб-интерфейса (только локальный доступ)

---

## Производительность

### Кэширование

- Список чатов кэшируется на 5 минут
- Принудительное обновление через параметр `?force=true`

### Оптимизация

- Асинхронная обработка сообщений
- Буферизация товаров
- Логирование в файлы (не блокирует основной поток)

---

## Зависимости

### Основные библиотеки

- `whatsapp-web.js` - Клиент WhatsApp Web
- `express` - Веб-сервер
- `axios` - HTTP клиент
- `winston` - Логирование
- `pg` - PostgreSQL драйвер
- `qrcode-terminal` - Отображение QR-кода в консоли
- `qrcode` - Генерация QR-кода для веб-интерфейса

---

## Расширяемость

### Добавление новых операций WhatsApp

1. Получить клиент через `getClient()` из `whatsapp-client.js`
2. Использовать методы из библиотеки `whatsapp-web.js`
3. Добавить API endpoint в `web-server.js`
4. Добавить обработку в веб-интерфейс (если нужно)

### Добавление новых типов обработки сообщений

1. Расширить `message-handler.js`
2. Добавить логику в `handleMessage()`
3. Обновить структуру БД при необходимости

---

## Известные ограничения

1. WhatsApp может ограничивать частоту отправки сообщений
2. Сессия может истечь и потребуется повторное сканирование QR-кода
3. Большие файлы медиа могут замедлить обработку
4. Получение списка чатов может занять время при большом количестве чатов

---

## Troubleshooting

### Клиент не подключается

- Проверьте интернет-соединение
- Удалите `.wwebjs_auth/` и пересканируйте QR-код
- Проверьте логи в `logs/combined.log`

### Сообщения не обрабатываются

- Проверьте настройки мониторинга в веб-интерфейсе
- Проверьте статус клиента через `/api/status`
- Проверьте логи обработки сообщений

### Ошибки отправки в API

- Проверьте доступность Spring Boot API
- Проверьте правильность URL и endpoint
- Проверьте логи в `logs/error.log`

---

*Документация обновлена: 2025-01-28*

