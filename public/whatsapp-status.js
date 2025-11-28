/**
 * Общий компонент статуса WhatsApp для всех страниц
 * Автоматически обновляет статус в элементе с id="serviceStatusBadge"
 */

(function() {
    'use strict';
    
    let statusInterval = null;
    
    /**
     * Обновляет статус WhatsApp клиента
     */
    async function refreshStatus() {
        try {
            const response = await fetch('/api/status');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            const badge = document.getElementById('serviceStatusBadge');
            if (!badge) {
                // Элемент не найден, это нормально для страниц без статуса
                return;
            }
            
            if (data.isReady) {
                badge.className = 'badge bg-success';
                badge.textContent = '✅ Подключен';
            } else {
                badge.className = 'badge bg-warning';
                badge.textContent = `⚠️ ${data.status || 'Не готов'}`;
            }
        } catch (error) {
            console.error('Ошибка получения статуса WhatsApp:', error);
            const badge = document.getElementById('serviceStatusBadge');
            if (badge) {
                badge.className = 'badge bg-danger';
                badge.textContent = '❌ Ошибка';
            }
        }
    }
    
    /**
     * Инициализирует компонент статуса
     */
    function initStatusComponent() {
        // Обновляем статус сразу при загрузке
        refreshStatus();
        
        // Обновляем статус каждые 5 секунд
        if (statusInterval) {
            clearInterval(statusInterval);
        }
        statusInterval = setInterval(refreshStatus, 5000);
        
        console.log('✅ Компонент статуса WhatsApp инициализирован');
    }
    
    // Инициализируем при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStatusComponent);
    } else {
        initStatusComponent();
    }
    
    // Экспортируем функцию для ручного обновления
    window.refreshWhatsAppStatus = refreshStatus;
})();


