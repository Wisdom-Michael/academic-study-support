import path from 'path';
import dotenv from 'dotenv';

// The .env file lives at the project root, two levels above this file
// (works for both src/config.ts in development and dist/config.js in production).
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * MySQL connection settings. Either set DATABASE_URL (the "Service URI" that hosts such
 * as Aiven show, mysql://user:password@host:port/db) or the separate DB_* variables.
 * The app always uses its own database, DB_NAME, which it creates on first start.
 */
function databaseSettings() {
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  // Hosted MySQL requires TLS; DB_SSL_CA holds the provider's CA certificate (PEM text)
  const ca = process.env.DB_SSL_CA?.replace(/\\n/g, '\n').trim();
  return {
    host: url?.hostname ?? process.env.DB_HOST ?? 'localhost',
    port: Number(url?.port || process.env.DB_PORT || 3306),
    user: url ? decodeURIComponent(url.username) : process.env.DB_USER ?? 'root',
    password: url ? decodeURIComponent(url.password) : process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'academic_support_db',
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
  };
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  production: process.env.NODE_ENV === 'production',

  db: databaseSettings(),

  // On first start against an empty database, create the tables and demo data automatically
  seedOnEmpty: (process.env.SEED_ON_EMPTY ?? 'true') !== 'false',
  // Optional: password given to every demo account when seeding (instead of the published Study@2026)
  demoPassword: process.env.DEMO_PASSWORD?.trim() || null,

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  institutionEmailDomain: (process.env.INSTITUTION_EMAIL_DOMAIN ?? '').trim().toLowerCase(),

  uploadsDir: path.resolve(__dirname, '../uploads'),         // seed chapters (and files from older versions)
  schemaFile: path.resolve(__dirname, '../../schema.sql'),
  clientBuildDir: path.resolve(__dirname, '../../client/dist'), // React build, served in production

  // Business rules, kept here so they are easy to find and explain
  matchScoreThreshold: 50,      // concept-check scores below this trigger peer matching
  helperScoreThreshold: 75,     // average module score that makes a student a suggested helper
  studentHelperCapacity: 2,     // students a helper can be asked to support at once
  maxUploadBytes: 20 * 1024 * 1024,
};
