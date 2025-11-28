/**
 * Менеджер заданий для мониторинга групп с промптами
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASKS_FILE = path.join(__dirname, 'tasks.json');

// Задания в памяти
let tasks = [];

/**
 * Загружает задания из файла
 */
export function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf8');
      tasks = JSON.parse(data);
      logger.info(`✅ Загружено ${tasks.length} заданий из файла`);
    } else {
      tasks = [];
      saveTasks();
      logger.info('📝 Создан новый файл заданий');
    }
  } catch (error) {
    logger.error(`❌ Ошибка загрузки заданий: ${error.message}`);
    tasks = [];
  }
}

/**
 * Сохраняет задания в файл
 */
function saveTasks() {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (error) {
    logger.error(`❌ Ошибка сохранения заданий: ${error.message}`);
  }
}

/**
 * Получает все задания
 */
export function getAllTasks() {
  return JSON.parse(JSON.stringify(tasks)); // Глубокая копия
}

/**
 * Получает задание по ID
 */
export function getTaskById(taskId) {
  return tasks.find(t => t.id === taskId);
}

/**
 * Создает новое задание
 */
export function createTask(name, promptId, chatIds) {
  const task = {
    id: Date.now(),
    name: name || `Задание ${Date.now()}`,
    promptId: promptId,
    chatIds: Array.isArray(chatIds) ? chatIds : [],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  tasks.push(task);
  saveTasks();
  logger.info(`✅ Создано задание ID=${task.id}, название="${task.name}", промпт=${promptId}, групп=${chatIds.length}`);
  return task;
}

/**
 * Обновляет задание
 */
export function updateTask(taskId, updates) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    throw new Error(`Задание с ID ${taskId} не найдено`);
  }
  
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  saveTasks();
  logger.info(`✅ Обновлено задание ID=${taskId}`);
  return task;
}

/**
 * Удаляет задание
 */
export function deleteTask(taskId) {
  const index = tasks.findIndex(t => t.id === taskId);
  if (index === -1) {
    throw new Error(`Задание с ID ${taskId} не найдено`);
  }
  
  tasks.splice(index, 1);
  saveTasks();
  logger.info(`✅ Удалено задание ID=${taskId}`);
  return true;
}

/**
 * Получает активные задания для указанного чата
 */
export function getActiveTasksForChat(chatId) {
  return tasks.filter(t => t.active && t.chatIds.includes(chatId));
}

/**
 * Инициализация при загрузке модуля
 */
loadTasks();

