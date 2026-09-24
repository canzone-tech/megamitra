import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['mysql'] })
    .required(),

  MYSQL_HOST: Joi.string().required(),
  MYSQL_PORT: Joi.number().port().required(),
  MYSQL_DATABASE: Joi.string().min(1).required(),
  MYSQL_USER: Joi.string().min(1).required(),
  MYSQL_PASSWORD: Joi.string().required(),

  MONGODB_URI: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  CAPTCHA_HMAC_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),

  MEGAMITRA_PUBLIC_URL: Joi.string().uri({ scheme: ['http', 'https'] }).default('http://127.0.0.1:3102'),
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_REQUIRE_TLS: Joi.boolean().default(true),
  SMTP_USERNAME: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  SMTP_FROM_EMAIL: Joi.string().email().allow('').default(''),
  SMTP_FROM_NAME: Joi.string().max(120).default('MegaMitra'),
  SMTP_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(10000),
}).unknown(true);
