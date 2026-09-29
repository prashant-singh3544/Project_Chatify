export const memoryUsers = [];
export const memoryMessages = [];

export const createMemoryId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;