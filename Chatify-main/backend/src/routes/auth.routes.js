import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import User from '../models/User.js';
import { protect } from '../middleware/auth.middleware.js';
import { createMemoryId, memoryUsers } from '../config/memory.store.js';

const router = express.Router();

const buildToken = (user) =>
  jwt.sign({ id: user._id.toString(), email: user.email, name: user.name }, process.env.JWT_SECRET || 'chatify-secret', {
    expiresIn: '7d',
  });

router.get('/', (req, res) => {
  res.json({ message: 'Auth service is alive' });
});

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  const normalizedEmail = email?.trim().toLowerCase();

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required' });
  }

  const existingUser = globalThis.__chatifyMongoEnabled === false
    ? memoryUsers.find((item) => item.email === normalizedEmail)
    : await User.findOne({ email: normalizedEmail }).catch(() => null);

  if (existingUser) {
    return res.status(409).json({ message: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = globalThis.__chatifyMongoEnabled === false
    ? { _id: createMemoryId(), name: name.trim(), email: normalizedEmail, password: hashedPassword, avatar: '' }
    : await User.create({ name, email: normalizedEmail, password: hashedPassword });

  if (globalThis.__chatifyMongoEnabled === false) memoryUsers.push(user);
  const token = buildToken(user);

  return res.status(201).json({
    message: 'Signup successful',
    token,
    user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar || '' },
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = email?.trim().toLowerCase();

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = globalThis.__chatifyMongoEnabled === false
    ? memoryUsers.find((item) => item.email === normalizedEmail)
    : await User.findOne({ email: normalizedEmail }).catch(() => null);

  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const isValid = await bcrypt.compare(password, user.password);

  if (!isValid) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const token = buildToken(user);

  return res.json({
    message: 'Login successful',
    token,
    user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar || '' },
  });
});

router.patch('/profile', protect, async (req, res) => {
  const name = req.body?.name?.trim();
  const avatar = req.body?.avatar?.trim() || '';

  if (!name || name.length < 2 || name.length > 60) {
    return res.status(400).json({ message: 'Name must be between 2 and 60 characters' });
  }

  if (avatar && !/^https?:\/\/.+/i.test(avatar) && !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(avatar)) {
    return res.status(400).json({ message: 'Avatar must be an image URL or uploaded image' });
  }

  if (avatar.length > 3 * 1024 * 1024) {
    return res.status(400).json({ message: 'Avatar image is too large' });
  }

  const user = globalThis.__chatifyMongoEnabled === false
    ? memoryUsers.find((item) => item._id.toString() === req.user.id)
    : await User.findById(req.user.id).catch(() => null);

  if (!user) return res.status(404).json({ message: 'User not found' });

  user.name = name;
  user.avatar = avatar;
  if (globalThis.__chatifyMongoEnabled !== false) await user.save();

  return res.json({
    message: 'Profile updated successfully',
    user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar || '' },
  });
});

router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful' });
});

router.get('/users', protect, async (req, res) => {
  const users = globalThis.__chatifyMongoEnabled === false
    ? memoryUsers.map(({ _id, name, email, avatar }) => ({ id: _id, name, email, avatar }))
    : await User.find({}, '_id name email avatar').lean().then((items) => items.map(({ _id, name, email, avatar }) => ({ id: _id, name, email, avatar })));
  return res.json({ users });
});

export default router;