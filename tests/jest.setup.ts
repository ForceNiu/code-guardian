// Jest setup file
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

declare global {
  // eslint-disable-next-line no-var
  var PrismaClientKnownRequestError: typeof PrismaClientKnownRequestError;
}

// Make PrismaClientKnownRequestError available globally for tests
global.PrismaClientKnownRequestError = PrismaClientKnownRequestError;

// Mock for worker_threads - Prisma needs this
jest.mock('node:worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    postMessage: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined),
  })),
  parentPort: null,
  workerData: {},
  isMainThread: true,
}));
