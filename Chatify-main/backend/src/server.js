import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';

import { connectToDatabase } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import messageRoutes from './routes/message.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const jwtSecret = process.env.JWT_SECRET || 'chatify-secret';
const app = express();
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...configuredOrigins,
]);
const isLocalOrigin = (origin) => {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
};
const isAllowedOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.has(origin) || isLocalOrigin(origin)) {
    return callback(null, true);
  }

  return callback(new Error(`Origin not allowed by CORS: ${origin}`));
};
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: isAllowedOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests from this IP, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many auth attempts from this IP, please try again later.' },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized socket connection'));

  try {
    socket.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return next(new Error('Invalid socket token'));
  }
});
app.set('io', io);

const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(generalLimiter);
app.use(
  cors({
    origin: isAllowedOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Chatify backend is running',
    database: globalThis.__chatifyMongoEnabled === false ? 'memory-fallback' : 'mongodb',
  });
});

app.get('/api/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    return res.json({ user: decoded });
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/messages', messageRoutes);

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Uploaded image is too large. Please choose an image under 2 MB.' });
  }

  return next(error);
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (room) => {
    if (room && room.split(':').includes(String(socket.user.id))) {
      socket.join(room);
    }
  });

  socket.on('typing', ({ room, user, isTyping }) => {
    if (room && room.split(':').includes(String(socket.user.id))) {
      socket.to(room).emit('typing', { room, user, isTyping });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../../frontend/dist');

  app.use(express.static(frontendPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

const startServer = async () => {
  const databaseEnabled = await connectToDatabase();
  server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
    console.log(`Database mode: ${databaseEnabled ? 'mongodb' : 'memory-fallback'}`);
  });
};

startServer();