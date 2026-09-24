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

  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),
  SECURITY_HSTS_ENABLED: Joi.boolean().default(false),
  RATE_LIMIT_ENABLED: Joi.boolean().default(true),
  RATE_LIMIT_TEST_ENABLED: Joi.boolean().default(false),
  RATE_LIMIT_GLOBAL_MAX: Joi.number().integer().min(1).max(100000).default(600),
  RATE_LIMIT_GLOBAL_WINDOW_MS: Joi.number().integer().min(1000).max(3600000).default(60000),
  RATE_LIMIT_AUTH_MAX: Joi.number().integer().min(1).max(10000).default(30),
  RATE_LIMIT_AUTH_WINDOW_MS: Joi.number().integer().min(1000).max(3600000).default(300000),
  RATE_LIMIT_RECOVERY_MAX: Joi.number().integer().min(1).max(10000).default(10),
  RATE_LIMIT_RECOVERY_WINDOW_MS: Joi.number().integer().min(1000).max(3600000).default(900000),

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
