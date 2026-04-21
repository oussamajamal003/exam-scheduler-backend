import { AsyncLocalStorage } from 'async_hooks';

export const auditContext = new AsyncLocalStorage();

export const getAuditUserId = () => {
  const store = auditContext.getStore();
  return store?.userId || null;
};
