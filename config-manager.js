import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'monitoring-config.json');

// Конфигурация по умолчанию
let monitoringConfig = {
  api: {
    url: process.env.API_URL || 'https://minerhive.ru',
    endpoint: process.env.API_ENDPOINT || '/api/webhook/whatsapp',
    apiKey: process.env.API_KEY || null
  },
  groups: [],
  personalChats: [],
  monitorAllGroups: false,
  monitorAllPersonal: false,
  // Опции логирования
  logging: {
    logReceivedMessages: true, // Логировать все полученные сообщения
    logOllamaResponse: true, // Логировать детали обработки ответа Ollama
    skipOwnMessages: false // Пропускать сообщения от самого себя (по умолчанию НЕТ - обрабатываем все)
  }
};

/**
 * Загружает конфигурацию из файла
 */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      monitoringConfig = { ...monitoringConfig, ...JSON.parse(data) };
    } else {
      // Создаем файл с настройками по умолчанию
      saveConfig();
    }
  } catch (error) {
    console.error('Ошибка загрузки конфигурации:', error);
  }
  return monitoringConfig;
}

/**
 * Сохраняет конфигурацию в файл
 */
export function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(monitoringConfig, null, 2));
    return true;
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
    return false;
  }
}

/**
 * Получает текущую конфигурацию
 */
export function getMonitoringConfig() {
  return monitoringConfig;
}

/**
 * Обновляет конфигурацию
 */
export function updateConfig(newConfig) {
  monitoringConfig = {
    ...monitoringConfig,
    ...newConfig
  };
  return saveConfig();
}

/**
 * Обновляет API конфигурацию
 */
export function updateApiConfig(url, endpoint, apiKey) {
  monitoringConfig.api = {
    url: url || monitoringConfig.api.url,
    endpoint: endpoint || monitoringConfig.api.endpoint,
    apiKey: apiKey !== undefined ? apiKey : monitoringConfig.api.apiKey
  };
  return saveConfig();
}

/**
 * Обновляет список групп для мониторинга
 */
export function updateMonitoredGroups(groups, monitorAll = false) {
  monitoringConfig.groups = groups || [];
  monitoringConfig.monitorAllGroups = monitorAll;
  return saveConfig();
}

/**
 * Обновляет список личных чатов для мониторинга
 */
export function updateMonitoredPersonalChats(chats, monitorAll = false) {
  monitoringConfig.personalChats = chats || [];
  monitoringConfig.monitorAllPersonal = monitorAll;
  return saveConfig();
}

/**
 * Обновляет настройки логирования
 */
export function updateLoggingConfig(logReceivedMessages, logOllamaResponse, skipOwnMessages) {
  if (!monitoringConfig.logging) {
    monitoringConfig.logging = {};
  }
  if (logReceivedMessages !== undefined) {
    monitoringConfig.logging.logReceivedMessages = logReceivedMessages === true;
  }
  if (logOllamaResponse !== undefined) {
    monitoringConfig.logging.logOllamaResponse = logOllamaResponse === true;
  }
  if (skipOwnMessages !== undefined) {
    monitoringConfig.logging.skipOwnMessages = skipOwnMessages === true;
  }
  return saveConfig();
}

// Загружаем конфигурацию при импорте
loadConfig();
