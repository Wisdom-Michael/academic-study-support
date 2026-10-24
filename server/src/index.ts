import fs from 'fs';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { config } from './config';
import { checkConnection } from './db';
import { requireAuth } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { prepareDatabase } from './setup';
import { HttpError } from './types';
import authRoutes from './routes/auth';
import materialRoutes from './routes/materials';
import conceptCheckRoutes from './routes/conceptChecks';
import { matchesRouter, mentorModulesRouter } from './routes/matches';
import analyticsRoutes from './routes/analytics';

const app = express();

// Behind a hosting proxy (Render), trust it to report the visitor's real IP address
if (config.production) app.set('trust proxy', 1);

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '100kb' }));

// --- Public routes ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth/login', rateLimit({
  max: 10, windowMs: 15 * 60_000, message: 'Too many sign-in attempts. Wait 15 minutes and try again.',
}));
app.use('/api/auth/register', rateLimit({
  max: 5, windowMs: 60 * 60_000, message: 'Too many accounts created from this network. Try again later.',
}));
app.use('/api/auth', authRoutes);

// --- Everything below requires a signed-in user ---
app.use('/api', requireAuth);
app.use('/api/materials/:materialId/concept-check', conceptCheckRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/matches', matchesRouter);
app.use('/api/mentor-modules', mentorModulesRouter);
app.use('/api/analytics', analyticsRoutes);

app.use('/api', (_req, _res) => {
  throw new HttpError(404, 'Endpoint not found.');
});

// --- The React app (production build), served from the same address as the API ---
const clientIndex = path.join(config.clientBuildDir, 'index.html');
if (fs.existsSync(clientIndex)) {
  app.use(express.static(config.clientBuildDir, { index: false, maxAge: '1h' }));
  // Any other path is a page in the React app (e.g. /student, /materials/3)
  app.get('/{*page}', (_req, res) => res.sendFile(clientIndex));
}

// --- Central error handler: every thrown error ends up here ---
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Files must be ${config.maxUploadBytes / (1024 * 1024)} MB or smaller.`
      : 'The upload could not be processed.';
    return res.status(400).json({ error: message });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

async function start() {
  try {
    await prepareDatabase();
    await checkConnection();
  } catch (err) {
    console.error(
      `Could not set up the database at ${config.db.host}:${config.db.port} as "${config.db.user}".\n` +
      'Check that MySQL is running and the database settings (.env locally, environment variables when hosted) are correct.\n',
      err instanceof Error ? err.message || (err as NodeJS.ErrnoException).code : err,
    );
    process.exit(1);
  }
  app.listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
  });
}

start();
