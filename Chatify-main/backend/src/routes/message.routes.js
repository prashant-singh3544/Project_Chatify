import express from 'express';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.middleware.js';
import { createMemoryId, memoryMessages, memoryUsers } from '../config/memory.store.js';

const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const contactId = req.query.contactId?.trim();
    if (!currentUserId || !contactId) return res.json({ messages: [] });

    const messages = globalThis.__chatifyMongoEnabled === false
      ? memoryMessages.filter((item) =>
        (item.senderId === currentUserId && item.recipientId === contactId)
        || (item.senderId === contactId && item.recipientId === currentUserId)
      ).slice(-100)
      : await Message.find({
        $or: [
          { senderId: currentUserId, recipientId: contactId },
          { senderId: contactId, recipientId: currentUserId },
        ],
      }).sort({ createdAt: 1 }).limit(100).lean();
    return res.json({ messages });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load messages' });
  }
});

router.post('/send', protect, async (req, res) => {
  const { text, recipientId } = req.body || {};

  if (!text || !text.trim() || !recipientId) {
    return res.status(400).json({ message: 'Message text and recipient are required' });
  }

  if (recipientId === req.user.id) return res.status(400).json({ message: 'You cannot message yourself' });

  const currentUser = globalThis.__chatifyMongoEnabled === false
    ? memoryUsers.find((item) => item._id.toString() === req.user.id)
    : await User.findById(req.user.id).select('name').lean().catch(() => null);
  const recipient = globalThis.__chatifyMongoEnabled === false
    ? memoryUsers.find((item) => item._id.toString() === recipientId)
    : await User.findById(recipientId).select('_id').lean().catch(() => null);
  if (!recipient) return res.status(404).json({ message: 'Recipient not found' });

  const senderName = currentUser?.name || req.user.name || req.user.email || 'User';
  const message = globalThis.__chatifyMongoEnabled === false
    ? {
        _id: createMemoryId(),
        senderId: req.user.id,
        recipientId,
        sender: senderName,
        text: text.trim(),
        createdAt: new Date().toISOString(),
      }
    : await Message.create({
        senderId: req.user.id,
        recipientId,
        sender: senderName,
        text: text.trim(),
      });

  if (globalThis.__chatifyMongoEnabled === false) memoryMessages.push(message);

  const broadcastMessage = message.toObject ? message.toObject() : message;
  const privateRoom = [req.user.id, recipientId].sort().join(':');
  req.app.get('io').to(privateRoom).emit('new-message', broadcastMessage);

  return res.status(201).json({
    message: 'Message sent successfully',
    payload: message,
  });
});

router.patch('/:messageId', protect, async (req, res) => {
  const { text } = req.body || {};
  const trimmedText = text?.trim();

  if (!trimmedText) {
    return res.status(400).json({ message: 'Message text is required.' });
  }

  const messageId = req.params.messageId;

  if (globalThis.__chatifyMongoEnabled === false) {
    const targetIndex = memoryMessages.findIndex((item) => String(item._id) === String(messageId) && String(item.senderId) === String(req.user.id));
    if (targetIndex === -1) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    const updatedMessage = {
      ...memoryMessages[targetIndex],
      text: trimmedText.slice(0, 2000),
      updatedAt: new Date().toISOString(),
    };
    memoryMessages[targetIndex] = updatedMessage;

    const privateRoom = [req.user.id, updatedMessage.recipientId].sort().join(':');
    req.app.get('io').to(privateRoom).emit('message-updated', updatedMessage);

    return res.json({ message: 'Message updated successfully', payload: updatedMessage });
  }

  const updatedMessage = await Message.findOne({ _id: messageId, senderId: req.user.id }).catch(() => null);
  if (!updatedMessage) {
    return res.status(404).json({ message: 'Message not found.' });
  }

  updatedMessage.text = trimmedText.slice(0, 2000);
  await updatedMessage.save();

  const privateRoom = [req.user.id, updatedMessage.recipientId].sort().join(':');
  req.app.get('io').to(privateRoom).emit('message-updated', updatedMessage.toObject());

  return res.json({ message: 'Message updated successfully', payload: updatedMessage.toObject() });
});

router.delete('/:messageId', protect, async (req, res) => {
  const messageId = req.params.messageId;

  if (globalThis.__chatifyMongoEnabled === false) {
    const targetIndex = memoryMessages.findIndex((item) => String(item._id) === String(messageId) && String(item.senderId) === String(req.user.id));
    if (targetIndex === -1) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    const deletedMessage = memoryMessages[targetIndex];
    memoryMessages.splice(targetIndex, 1);

    const privateRoom = [req.user.id, deletedMessage.recipientId].sort().join(':');
    req.app.get('io').to(privateRoom).emit('message-deleted', { messageId: String(messageId) });

    return res.json({ message: 'Message deleted successfully', messageId: String(messageId) });
  }

  const deletedMessage = await Message.findOne({ _id: messageId, senderId: req.user.id }).catch(() => null);
  if (!deletedMessage) {
    return res.status(404).json({ message: 'Message not found.' });
  }

  const roomId = [req.user.id, deletedMessage.recipientId].sort().join(':');
  await deletedMessage.deleteOne();
  req.app.get('io').to(roomId).emit('message-deleted', { messageId: String(messageId) });

  return res.json({ message: 'Message deleted successfully', messageId: String(messageId) });
});

export default router;