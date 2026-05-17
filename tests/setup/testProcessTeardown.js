import { closePrismaConnections } from '../../src/config/prisma.js';

const formatHandle = (handle) => {
  const type = handle?.constructor?.name ?? typeof handle;

  if (type === 'Socket') {
    return {
      type,
      localAddress: handle.localAddress,
      localPort: handle.localPort,
      remoteAddress: handle.remoteAddress,
      remotePort: handle.remotePort,
      bytesRead: handle.bytesRead,
      bytesWritten: handle.bytesWritten,
      readable: handle.readable,
      writable: handle.writable,
    };
  }

  if (type === 'Server') {
    return {
      type,
      listening: handle.listening,
    };
  }

  if (type === 'TLSSocket') {
    return {
      type,
      localAddress: handle.localAddress,
      localPort: handle.localPort,
      remoteAddress: handle.remoteAddress,
      remotePort: handle.remotePort,
    };
  }

  return { type };
};

if (!globalThis.__JEST_PRISMA_TEARDOWN_REGISTERED__) {
  globalThis.__JEST_PRISMA_TEARDOWN_REGISTERED__ = true;

  if (process.env.JEST_TRACE_HANDLES === '1') {
    afterAll(async () => {
      await closePrismaConnections();
      await new Promise((resolve) => setImmediate(resolve));

      const handles = (process._getActiveHandles?.() ?? []).map(formatHandle);
      const requests = (process._getActiveRequests?.() ?? []).map((request) => ({
        type: request?.constructor?.name ?? typeof request,
      }));

      // eslint-disable-next-line no-console
      console.log('[jest-trace] active handles after suite', JSON.stringify(handles, null, 2));
      // eslint-disable-next-line no-console
      console.log('[jest-trace] active requests after suite', JSON.stringify(requests, null, 2));
    });
  }

  process.once('beforeExit', async () => {
    await closePrismaConnections();
  });
}
