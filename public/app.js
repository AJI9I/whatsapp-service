// Глобальные переменные
let selectedGroups = [];
let selectedPersonalChats = [];
let allGroups = [];
let allPersonalChats = [];

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('🚀 Инициализация главной страницы...');
        
        // Обновляем статус
        refreshStatus();
        
        // Обновляем информацию о модели
        refreshModelInfo();
        
        // Загружаем конфигурации
        loadApiConfig();
        loadLoggingConfig();
        loadMonitoringConfig();
        
        // Загружаем чаты
        refreshChats();
        
        // Обновление статуса каждые 3 секунды
        setInterval(refreshStatus, 3000);
        
        // Обновление логов каждые 2 секунды (только если контейнер существует)
        const logsContainer = document.getElementById('logsContainer');
        if (logsContainer) {
            refreshLogs();
            setInterval(refreshLogs, 2000);
        }
        
        // Обновление оборудования каждые 3 секунды
        refreshProducts();
        setInterval(refreshProducts, 3000);
        
        // Отслеживание прокрутки логов (если контейнер существует)
        const logsContainerEl = document.getElementById('logsContainer');
        if (logsContainerEl) {
            logsContainerEl.addEventListener('scroll', () => {
                isScrolledToBottom = checkIfScrolledToBottom();
            });
        }
        
        // Обработка формы API конфигурации
        const apiConfigForm = document.getElementById('apiConfigForm');
        if (apiConfigForm) {
            apiConfigForm.addEventListener('submit', saveApiConfig);
        } else {
            console.warn('⚠️ Форма apiConfigForm не найдена');
        }
        
        // Обработка формы настроек логирования
        const loggingConfigForm = document.getElementById('loggingConfigForm');
        if (loggingConfigForm) {
            loggingConfigForm.addEventListener('submit', saveLoggingConfig);
        } else {
            console.warn('⚠️ Форма loggingConfigForm не найдена');
        }
        
        // Обработка формы тестового сообщения
        const testMessageForm = document.getElementById('testMessageForm');
        if (testMessageForm) {
            testMessageForm.addEventListener('submit', sendTestMessage);
        } else {
            console.warn('⚠️ Форма testMessageForm не найдена');
        }
        
        console.log('✅ Инициализация главной страницы завершена');
    } catch (error) {
        console.error('❌ Ошибка инициализации главной страницы:', error);
    }
});

/**
 * Обновить информацию о модели Ollama
 */
async function refreshModelInfo() {
    const container = document.getElementById('modelInfoContainer');
    if (!container) return;
    
    try {
        container.innerHTML = '<div class="text-center py-3"><span class="loading"></span><span class="ms-2">Загрузка...</span></div>';
        
        const response = await fetch('/api/model-info');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        let html = '<div class="row">';
        
        // Основная информация
        html += '<div class="col-md-6 mb-3">';
        html += '<strong>Модель:</strong> ';
        html += `<span class="badge bg-primary ms-2">${escapeHtml(data.model || 'Не указана')}</span>`;
        html += '</div>';
        
        html += '<div class="col-md-6 mb-3">';
        html += '<strong>Ollama URL:</strong> ';
        html += `<span class="text-muted ms-2">${escapeHtml(data.ollamaUrl || 'Не указан')}</span>`;
        html += '</div>';
        
        // Детальная информация о модели
        html += '<div class="col-12 mb-3">';
        html += '<div class="card border-info">';
        html += '<div class="card-body">';
        html += '<h6 class="card-title"><i class="bi bi-info-circle"></i> Технические характеристики модели</h6>';
        html += '<div class="row">';
        
        if (data.architecture) {
          html += '<div class="col-md-6 mb-2"><strong>Архитектура:</strong> <code>' + escapeHtml(data.architecture) + '</code></div>';
        }
        if (data.parameters) {
          html += '<div class="col-md-6 mb-2"><strong>Параметров:</strong> <code>' + escapeHtml(data.parameters) + '</code></div>';
        }
        if (data.contextSize) {
          html += '<div class="col-md-6 mb-2"><strong>📏 Максимальный размер контекста:</strong> <code class="text-success">' + escapeHtml(data.contextSizeFormatted) + '</code></div>';
        }
        if (data.embeddingLength) {
          html += '<div class="col-md-6 mb-2"><strong>Длина эмбеддинга:</strong> <code>' + escapeHtml(String(data.embeddingLength)) + '</code></div>';
        }
        if (data.quantization) {
          html += '<div class="col-md-6 mb-2"><strong>Квантование:</strong> <code>' + escapeHtml(data.quantization) + '</code></div>';
        }
        
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        
        // Дополнительная информация
        if (data.details) {
            html += '<div class="col-12">';
            html += '<details>';
            html += '<summary class="btn btn-sm btn-outline-secondary">Показать полную информацию о модели</summary>';
            html += '<pre class="mt-3 p-3 bg-light border rounded" style="max-height: 400px; overflow-y: auto;">';
            html += escapeHtml(JSON.stringify(data.fullInfo, null, 2));
            html += '</pre>';
            html += '</details>';
            html += '</div>';
        }
        
        html += '</div>';
        
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `
            <div class="alert alert-danger mb-0">
                <strong>Ошибка загрузки информации о модели:</strong><br>
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}

/**
 * Отправить тестовое сообщение
 */
async function sendTestMessage(event) {
    event.preventDefault();
    
    const content = document.getElementById('testMessageContent').value.trim();
    const chatName = document.getElementById('testChatName').value.trim() || 'Test Group';
    const senderName = document.getElementById('testSenderName').value.trim() || 'Test User';
    const senderPhone = document.getElementById('testSenderPhone').value.trim() || '79999999999';
    const isGroup = document.querySelector('input[name="testIsGroup"]:checked').value === 'true';
    
    if (!content) {
        showToast('Введите текст сообщения', 'error');
        return;
    }
    
    const submitButton = event.target.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="loading"></span> Отправка...';
    
    try {
        const response = await fetch('/api/test-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: content,
                chatName: chatName,
                senderName: senderName,
                senderPhone: senderPhone,
                isGroup: isGroup
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Тестовое сообщение успешно отправлено и обработано!', 'success');
            
            // Очищаем форму (опционально, можно закомментировать если нужно сохранять)
            // document.getElementById('testMessageContent').value = '';
            
            // Обновляем логи через 1 секунду, чтобы увидеть новое сообщение
            setTimeout(() => {
                refreshLogs();
            }, 1000);
        } else {
            showToast(`Ошибка: ${data.error || 'Неизвестная ошибка'}`, 'error');
        }
    } catch (error) {
        showToast(`Ошибка отправки: ${error.message}`, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

/**
 * Переподключить WhatsApp клиент
 */
async function reconnectClient() {
    if (!confirm('Переподключить WhatsApp клиент? Это может занять некоторое время.')) {
        return;
    }
    
    try {
        console.log('🔄 Начало переподключения WhatsApp клиента...');
        const response = await fetch('/api/reconnect', {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ Ответ от сервера:', data);
        
        if (data.success) {
            showToast('Клиент переподключается...', 'info');
            // Обновляем статус через 2 секунды
            setTimeout(() => {
                refreshStatus();
                loadQRCode();
            }, 2000);
        } else {
            throw new Error(data.error || 'Ошибка переподключения');
        }
    } catch (error) {
        console.error('❌ Ошибка переподключения:', error);
        const errorMessage = error.message || 'Неизвестная ошибка';
        showToast(`Ошибка переподключения: ${errorMessage}`, 'danger');
    }
}

/**
 * Обновить статус подключения
 */
async function refreshStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        // Обновляем статус подключения
        const statusBadge = document.getElementById('connectionStatus');
        const statusText = {
            'disconnected': 'Отключен',
            'connecting': 'Подключение...',
            'connected': 'Подключен',
            'ready': 'Готов'
        };
        
        const statusClass = {
            'disconnected': 'bg-danger',
            'connecting': 'bg-warning',
            'connected': 'bg-info',
            'ready': 'bg-success'
        };
        
        statusBadge.className = `badge status-badge ${statusClass[data.status] || 'bg-secondary'}`;
        statusBadge.innerHTML = statusText[data.status] || data.status;
        
        // Показываем QR-код если нужно
        if (data.status === 'connecting') {
            loadQRCode();
        } else if (data.status === 'ready' || data.status === 'connected') {
            document.getElementById('qrcodeContainer').style.display = 'none';
            // Обновляем информацию о клиенте
            if (data.monitoring && data.monitoring.clientInfo) {
                document.getElementById('clientInfo').textContent = 
                    `${data.monitoring.clientInfo.pushname || 'Unknown'} (${data.monitoring.clientInfo.wid?.user || 'Unknown'})`;
            }
        } else {
            document.getElementById('qrcodeContainer').style.display = 'none';
        }
        
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        showToast('Ошибка получения статуса', 'danger');
    }
}

/**
 * Загрузить QR-код
 */
async function loadQRCode() {
    try {
        const response = await fetch('/api/qrcode');
        const data = await response.json();
        
        if (data.qrCode) {
            document.getElementById('qrcodeImage').src = data.qrCode;
            document.getElementById('qrcodeContainer').style.display = 'block';
        } else {
            document.getElementById('qrcodeContainer').style.display = 'none';
        }
    } catch (error) {
        console.error('Ошибка загрузки QR-кода:', error);
    }
}

/**
 * Обновить список чатов
 */
async function refreshChats() {
    try {
        console.log('🔄 Обновление списка чатов...');
        const response = await fetch('/api/chats');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('📋 Данные чатов получены:', {
            groups: data.groups?.length || 0,
            personalChats: data.personalChats?.length || 0,
            status: data.status,
            error: data.error
        });
        
        // Проверяем наличие ошибки
        if (data.error) {
            console.warn('⚠️ Ошибка от API:', data.error);
            const groupsList = document.getElementById('groupsList');
            const personalList = document.getElementById('personalChatsList');
            if (groupsList) {
                groupsList.innerHTML = `<div class="alert alert-warning">${escapeHtml(data.error)}</div>`;
            }
            if (personalList) {
                personalList.innerHTML = `<div class="alert alert-warning">${escapeHtml(data.error)}</div>`;
            }
            return;
        }
        
        allGroups = data.groups || [];
        allPersonalChats = data.personalChats || [];
        
        renderChats();
        console.log('✅ Список чатов обновлен');
    } catch (error) {
        console.error('❌ Ошибка получения списка чатов:', error);
        const groupsList = document.getElementById('groupsList');
        const personalList = document.getElementById('personalChatsList');
        if (groupsList) {
            groupsList.innerHTML = `<div class="alert alert-danger">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
        }
        if (personalList) {
            personalList.innerHTML = `<div class="alert alert-danger">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
        }
        if (typeof showToast === 'function') {
            showToast('Ошибка получения списка чатов', 'danger');
        }
    }
}

/**
 * Отобразить списки чатов
 */
function renderChats() {
    try {
        console.log('📋 Отображение чатов...', { groups: allGroups.length, personal: allPersonalChats.length });
        
        // Рендерим группы
        const groupsList = document.getElementById('groupsList');
        if (!groupsList) {
            console.warn('⚠️ Элемент groupsList не найден');
            return;
        }
        
        if (allGroups.length === 0) {
            groupsList.innerHTML = '<div class="text-center text-muted">Группы не найдены</div>';
        } else {
            groupsList.innerHTML = allGroups.map(group => `
                <div class="chat-item p-2 mb-2 border rounded ${selectedGroups.includes(group.id) ? 'selected' : ''}" 
                     onclick="toggleGroup('${escapeHtml(group.id)}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${escapeHtml(group.name)}</strong>
                            ${group.unreadCount > 0 ? `<span class="badge bg-danger ms-2">${group.unreadCount}</span>` : ''}
                        </div>
                        <i class="bi bi-check-circle-fill text-success ${selectedGroups.includes(group.id) ? '' : 'd-none'}" 
                           id="group-check-${escapeHtml(group.id)}"></i>
                    </div>
                </div>
            `).join('');
        }
        
        // Рендерим личные чаты
        const personalList = document.getElementById('personalChatsList');
        if (!personalList) {
            console.warn('⚠️ Элемент personalChatsList не найден');
            return;
        }
        
        if (allPersonalChats.length === 0) {
            personalList.innerHTML = '<div class="text-center text-muted">Личные чаты не найдены</div>';
        } else {
            personalList.innerHTML = allPersonalChats.map(chat => `
                <div class="chat-item p-2 mb-2 border rounded ${selectedPersonalChats.includes(chat.id) ? 'selected' : ''}" 
                     onclick="togglePersonal('${escapeHtml(chat.id)}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${escapeHtml(chat.name)}</strong>
                        ${chat.unreadCount > 0 ? `<span class="badge bg-danger ms-2">${chat.unreadCount}</span>` : ''}
                    </div>
                    <i class="bi bi-check-circle-fill text-success ${selectedPersonalChats.includes(chat.id) ? '' : 'd-none'}" 
                       id="personal-check-${chat.id}"></i>
                </div>
            </div>
        `).join('');
    }
}

/**
 * Переключить выбор группы
 */
function toggleGroup(groupId) {
    const index = selectedGroups.indexOf(groupId);
    if (index > -1) {
        selectedGroups.splice(index, 1);
    } else {
        selectedGroups.push(groupId);
    }
    renderChats();
}

/**
 * Переключить выбор личного чата
 */
function togglePersonal(chatId) {
    const index = selectedPersonalChats.indexOf(chatId);
    if (index > -1) {
        selectedPersonalChats.splice(index, 1);
    } else {
        selectedPersonalChats.push(chatId);
    }
    renderChats();
}

/**
 * Загрузить конфигурацию API
 */
async function loadApiConfig() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        document.getElementById('apiUrl').value = data.api.url || '';
        document.getElementById('apiEndpoint').value = data.api.endpoint || '';
        document.getElementById('apiKey').value = data.api.apiKey || '';
    } catch (error) {
        console.error('Ошибка загрузки конфигурации API:', error);
    }
}

/**
 * Загрузить настройки логирования
 */
async function loadLoggingConfig() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        const logging = data.logging || {};
        document.getElementById('logReceivedMessages').checked = logging.logReceivedMessages !== false; // По умолчанию true
        document.getElementById('logOllamaResponse').checked = logging.logOllamaResponse !== false; // По умолчанию true
        document.getElementById('skipOwnMessages').checked = logging.skipOwnMessages === true; // По умолчанию false
    } catch (error) {
        console.error('Ошибка загрузки настроек логирования:', error);
    }
}

/**
 * Сохранить настройки логирования
 */
async function saveLoggingConfig(event) {
    event.preventDefault();
    
    const logReceivedMessages = document.getElementById('logReceivedMessages').checked;
    const logOllamaResponse = document.getElementById('logOllamaResponse').checked;
    const skipOwnMessages = document.getElementById('skipOwnMessages').checked;
    
    try {
        const response = await fetch('/api/config/logging', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ logReceivedMessages, logOllamaResponse, skipOwnMessages })
        });
        
        if (response.ok) {
            showToast('Настройки логирования сохранены', 'success');
        } else {
            throw new Error('Ошибка сохранения');
        }
    } catch (error) {
        console.error('Ошибка сохранения настроек логирования:', error);
        showToast('Ошибка сохранения настроек логирования', 'danger');
    }
}

/**
 * Загрузить конфигурацию мониторинга
 */
async function loadMonitoringConfig() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        // Обновляем выбранные группы и чаты
        selectedGroups = data.groups || [];
        selectedPersonalChats = data.personalChats || [];
        
        // Обновляем чекбоксы
        document.getElementById('monitorAllGroups').checked = data.monitorAllGroups || false;
        document.getElementById('monitorAllPersonal').checked = data.monitorAllPersonal || false;
        
        // Перерисовываем списки после загрузки чатов
        setTimeout(() => {
            renderChats();
        }, 500);
    } catch (error) {
        console.error('Ошибка загрузки конфигурации мониторинга:', error);
    }
}

/**
 * Сохранить конфигурацию API
 */
async function saveApiConfig(event) {
    event.preventDefault();
    
    const url = document.getElementById('apiUrl').value;
    const endpoint = document.getElementById('apiEndpoint').value;
    const apiKey = document.getElementById('apiKey').value;
    
    try {
        const response = await fetch('/api/config/api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, endpoint, apiKey })
        });
        
        if (response.ok) {
            showToast('Конфигурация API сохранена', 'success');
        } else {
            throw new Error('Ошибка сохранения');
        }
    } catch (error) {
        console.error('Ошибка сохранения конфигурации API:', error);
        showToast('Ошибка сохранения конфигурации API', 'danger');
    }
}

/**
 * Сохранить конфигурацию групп
 */
async function saveGroupsConfig() {
    const monitorAll = document.getElementById('monitorAllGroups').checked;
    
    try {
        const response = await fetch('/api/config/groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ groups: selectedGroups, monitorAll })
        });
        
        if (response.ok) {
            showToast('Конфигурация групп сохранена', 'success');
        } else {
            throw new Error('Ошибка сохранения');
        }
    } catch (error) {
        console.error('Ошибка сохранения конфигурации групп:', error);
        showToast('Ошибка сохранения конфигурации групп', 'danger');
    }
}

/**
 * Сохранить конфигурацию личных чатов
 */
async function savePersonalConfig() {
    const monitorAll = document.getElementById('monitorAllPersonal').checked;
    
    try {
        const response = await fetch('/api/config/personal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chats: selectedPersonalChats, monitorAll })
        });
        
        if (response.ok) {
            showToast('Конфигурация личных чатов сохранена', 'success');
        } else {
            throw new Error('Ошибка сохранения');
        }
    } catch (error) {
        console.error('Ошибка сохранения конфигурации личных чатов:', error);
        showToast('Ошибка сохранения конфигурации личных чатов', 'danger');
    }
}

/**
 * Показать toast уведомление
 */
function showToast(message, type = 'info') {
    try {
        // Ищем или создаем контейнер для toast
        let toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            // Создаем контейнер, если его нет
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
            toastContainer.style.zIndex = '9999';
            document.body.appendChild(toastContainer);
            console.log('✅ Создан контейнер для toast уведомлений');
        }
        
        const toastId = 'toast-' + Date.now();
        
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white bg-${type} border-0`;
        toast.id = toastId;
        toast.setAttribute('role', 'alert');
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${escapeHtml(message)}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        
        const bsToast = new bootstrap.Toast(toast, {
            autohide: true,
            delay: 3000
        });
        
        bsToast.show();
        
        toast.addEventListener('hidden.bs.toast', () => {
            toast.remove();
        });
    } catch (error) {
        console.error('❌ Ошибка показа toast уведомления:', error);
        // Fallback: показываем alert, если toast не работает
        alert(message);
    }
}

/**
 * Экранирование HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Переменная для отслеживания прокрутки логов
let isScrolledToBottom = true;
let lastLogsCount = 0;

/**
 * Проверяет, находится ли пользователь внизу контейнера логов
 */
function checkIfScrolledToBottom() {
    const logsContainer = document.getElementById('logsContainer');
    if (!logsContainer) return true;
    
    const threshold = 50; // Порог в пикселях от низа
    const isAtBottom = logsContainer.scrollHeight - logsContainer.scrollTop - logsContainer.clientHeight < threshold;
    return isAtBottom;
}

/**
 * Обновить логи
 */
async function refreshLogs() {
    try {
        const response = await fetch('/api/logs?limit=200');
        
        if (!response.ok) {
            console.error('Ошибка получения логов:', response.status, response.statusText);
            const logsContainer = document.getElementById('logsContainer');
            if (logsContainer) {
                logsContainer.innerHTML = `<div class="text-center text-danger p-3">Ошибка загрузки логов: ${response.status} ${response.statusText}</div>`;
            }
            return;
        }
        
        const data = await response.json();
        
        const logsContainer = document.getElementById('logsContainer');
        if (!logsContainer) {
            console.error('Контейнер логов не найден');
            return;
        }
        
        // Проверяем, был ли пользователь внизу до обновления
        isScrolledToBottom = checkIfScrolledToBottom();
        
        // Проверяем, появились ли новые логи
        const hasNewLogs = data.logs && data.logs.length > lastLogsCount;
        lastLogsCount = data.logs ? data.logs.length : 0;
        
        if (data.logs && data.logs.length > 0) {
            logsContainer.innerHTML = data.logs.map(log => {
                const levelClass = `log-level-${(log.level || 'INFO').toLowerCase()}`;
                const timestamp = log.timestamp || new Date().toISOString();
                const level = log.level || 'INFO';
                const message = log.message || '';
                
                let logHtml = `
                    <div class="log-entry">
                        <span class="log-timestamp">${escapeHtml(timestamp)}</span>
                        <span class="${levelClass}">[${escapeHtml(level)}]</span>
                        <span class="log-message">${escapeHtml(message)}</span>
                `;
                
                // Если есть дополнительные данные (JSON), показываем их
                if (log.data && log.data !== null) {
                    try {
                        // Если есть поле json, используем его, иначе пытаемся сериализовать data
                        let jsonStr = '';
                        if (typeof log.data === 'string') {
                            jsonStr = log.data;
                        } else if (log.data.json) {
                            jsonStr = log.data.json;
                        } else if (log.data.jsonData) {
                            jsonStr = log.data.jsonData;
                        } else {
                            // Пытаемся найти JSON в данных
                            const dataStr = JSON.stringify(log.data, null, 2);
                            jsonStr = dataStr !== '{}' ? dataStr : '';
                        }
                        if (jsonStr) {
                            logHtml += `<div class="log-data">${escapeHtml(jsonStr)}</div>`;
                        }
                    } catch (e) {
                        logHtml += `<div class="log-data">${escapeHtml(String(log.data))}</div>`;
                    }
                }
                
                logHtml += '</div>';
                return logHtml;
            }).join('');
            
            // Автопрокрутка вниз только если пользователь был внизу ИЛИ появились новые логи
            // И пользователь сейчас внизу
            if ((isScrolledToBottom && hasNewLogs) || (isScrolledToBottom && checkIfScrolledToBottom())) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
        } else {
            logsContainer.innerHTML = '<div class="text-center text-muted p-3">Логов пока нет. Логи появятся здесь после запуска приложения.</div>';
        }
    } catch (error) {
        console.error('Ошибка получения логов:', error);
        const logsContainer = document.getElementById('logsContainer');
        if (logsContainer) {
            logsContainer.innerHTML = `<div class="text-center text-danger p-3">Ошибка получения логов: ${error.message}</div>`;
        }
    }
}

/**
 * Очистить логи
 */
async function clearLogs() {
    if (!confirm('Очистить все логи?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/logs/clear', {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Логи очищены', 'success');
            lastLogsCount = 0;
            isScrolledToBottom = true;
            refreshLogs();
        } else {
            throw new Error('Ошибка очистки');
        }
    } catch (error) {
        console.error('Ошибка очистки логов:', error);
        showToast('Ошибка очистки логов', 'danger');
    }
}

/**
 * Обновить список оборудования
 */
async function refreshProducts() {
    try {
        console.debug('🔄 Обновление списка оборудования...');
        const response = await fetch('/api/products');
        
        if (!response.ok) {
            console.error('❌ Ошибка получения оборудования:', response.status, response.statusText);
            const tableBody = document.getElementById('productsTableBody');
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger p-3">Ошибка загрузки: ${response.status}</td></tr>`;
            }
            return;
        }
        
        const data = await response.json();
        console.debug(`📦 Получено ${data.count || 0} товаров от API`, data);
        
        const tableBody = document.getElementById('productsTableBody');
        const productsCount = document.getElementById('productsCount');
        
        if (!tableBody) {
            console.warn('⚠️  Элемент productsTableBody не найден в DOM');
            return;
        }
        
        // Обновляем счетчик
        if (productsCount) {
            productsCount.textContent = data.count || 0;
        }
        
        if (data.products && Array.isArray(data.products) && data.products.length > 0) {
            console.debug(`✅ Отображение ${data.products.length} товаров в таблице`);
            
            // Сортируем по timestamp (последние первыми) на случай, если API не вернул в правильном порядке
            const sortedProducts = [...data.products].sort((a, b) => {
                const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return timeB - timeA; // Последние первыми
            });
            
            tableBody.innerHTML = sortedProducts.map(product => {
                const price = product.price 
                    ? `${product.price} ${product.currency || ''}`.trim()
                    : 'Не указана';
                const time = product.timestamp 
                    ? new Date(product.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '';
                
                return `
                    <tr>
                        <td><strong>${escapeHtml(product.model || 'Не указана')}</strong></td>
                        <td>${escapeHtml(product.manufacturer || 'Не указан')}</td>
                        <td><code>${escapeHtml(product.hashrate || 'Не указан')}</code></td>
                        <td>${escapeHtml(price)}</td>
                        <td>${escapeHtml(product.location || 'Не указана')}</td>
                        <td class="text-muted small">${escapeHtml(time)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            console.debug('ℹ️  Товаров нет, отображаем сообщение "не найдено"');
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-3">Оборудование не найдено</td></tr>';
        }
    } catch (error) {
        console.error('❌ Ошибка получения оборудования:', error);
        const tableBody = document.getElementById('productsTableBody');
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger p-3">Ошибка: ${escapeHtml(error.message || 'Неизвестная ошибка')}</td></tr>`;
        }
    }
}

/**
 * Очистить список оборудования
 */
async function clearProducts() {
    if (!confirm('Очистить список оборудования?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/products/clear', {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Список оборудования очищен', 'success');
            refreshProducts();
        } else {
            throw new Error('Ошибка очистки');
        }
    } catch (error) {
        console.error('Ошибка очистки оборудования:', error);
        showToast('Ошибка очистки оборудования', 'danger');
    }
}
