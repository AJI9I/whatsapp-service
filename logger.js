import winston from 'winston';
import { addLog } from './log-buffer.js';

// Формат для добавления в буфер (вызывается для каждого лога)
const bufferFormat = winston.format((info) => {
  // Добавляем лог в буфер для веб-интерфейса
  addLog({
    timestamp: info.timestamp || new Date().toISOString(),
    level: info.level.toUpperCase(),
    message: info.stack || info.message || String(info[Symbol.for('message')] || ''),
    data: Object.keys(info).filter(key => !['level', 'message', 'timestamp', 'stack', Symbol.for('message'), Symbol.for('level'), Symbol.for('splat')].includes(key)).length > 0 ? 
      Object.fromEntries(Object.entries(info).filter(([key]) => !['level', 'message', 'timestamp', 'stack'].includes(key))) : null
  });
  return info;
});

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  bufferFormat(), // Добавляем формат для буфера
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

