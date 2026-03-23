import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { loadConfig } from './config';
import authRouter from './routes/auth';
import apiRouter from './routes/api';

const config = loadConfig();
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount routes
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// Export config and app for use by route modules
export { config, app };

app.listen(PORT, () => {
  console.log(`Reddit Summarizer server running on port ${PORT}`);
});
