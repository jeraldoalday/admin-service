import pino, { type LoggerOptions } from 'pino';
import { config } from '../config/index.js';

const options: LoggerOptions = {
  level: config.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
};

export const logger = pino(options);
