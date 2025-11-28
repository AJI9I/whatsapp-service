/**
 * Общее меню для всех страниц WhatsApp Service
 * Автоматически вставляет меню в элемент с id="main-menu"
 * Автоматически отмечает активный пункт меню на основе текущего URL
 */

(function() {
    'use strict';
    
    // Определяем текущий путь
    const currentPath = window.location.pathname;
    
    // Меню с пунктами
    const menuItems = [
        {
            href: '/',
            icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
            label: 'Главная'
        },
        {
            href: '/messages',
            icon: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
            label: 'Сообщения'
        },
        {
            href: '/chats',
            icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H6l-2-2V6h16v12z',
            label: 'Чаты'
        },
        {
            href: '/restore-contacts',
            icon: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 11h-4v-4h4v4zm0-5h-4V6h4v4zm5 5h-4v-4h4v4zm0-5h-4V6h4v4z',
            label: 'Восстановление'
        },
        {
            href: '/logs',
            icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
            label: 'Логи'
        },
        {
            href: '/api-test',
            icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
            label: 'Тест API'
        },
        {
            href: '/settings',
            icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
            label: 'Настройки'
        }
    ];
    
    /**
     * Инициализирует меню
     */
    function initMenu() {
        const menuContainer = document.getElementById('main-menu');
        if (!menuContainer) {
            console.warn('Элемент #main-menu не найден, меню не будет вставлено');
            return;
        }
        
        // Очищаем существующее содержимое
        menuContainer.innerHTML = '';
        
        // Создаем пункты меню
        menuItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'slide';
            
            const a = document.createElement('a');
            a.href = item.href;
            
            // Определяем, является ли пункт активным
            const isActive = currentPath === item.href || 
                           (item.href === '/' && currentPath === '/') ||
                           (item.href !== '/' && currentPath.startsWith(item.href));
            
            a.className = isActive ? 'side-menu__item active' : 'side-menu__item';
            
            // Создаем иконку
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            svg.setAttribute('class', 'side-menu__icon');
            svg.setAttribute('viewBox', '0 0 24 24');
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', item.icon);
            svg.appendChild(path);
            
            // Создаем текст
            const span = document.createElement('span');
            span.className = 'side-menu__label';
            span.textContent = item.label;
            
            a.appendChild(svg);
            a.appendChild(span);
            li.appendChild(a);
            menuContainer.appendChild(li);
        });
    }
    
    // Инициализируем меню при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMenu);
    } else {
        initMenu();
    }
    
    // Также инициализируем с небольшой задержкой на случай, если скрипт загрузился раньше
    setTimeout(initMenu, 100);
})();
