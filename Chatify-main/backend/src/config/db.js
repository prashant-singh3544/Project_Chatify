import mongoose from 'mongoose';

export const connectToDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.log('MONGODB_URI is not configured. Using in-memory fallback storage.');
    globalThis.__chatifyMongoEnabled = false;
    return false;
  }

  try {
    await mongoose.connect(mongoUri);
    globalThis.__chatifyMongoEnabled = true;
    console.log('MongoDB connected successfully');
    return true;
  } catch (error) {
    console.error('MongoDB connection failed, falling back to in-memory storage:', error.message);
    globalThis.__chatifyMongoEnabled = false;
    return false;
  }
};
