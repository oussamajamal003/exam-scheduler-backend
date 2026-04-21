import { getAuditUserId } from '../../middlewares/auditContext.js';

// Reusable audit logic pattern
export const applyAuditExtension = (prismaClient) => {
  return prismaClient.$extends({
    query: {
      $allModels: {
        async create({ model, operation, args, query }) {
          const userId = getAuditUserId();
          if (userId && args.data && model !== 'AuditLog') {
            args.data.createdBy = userId;
          }
          
          const result = await query(args);
          
          if (userId && model !== 'AuditLog' && result.id) {
            await prismaClient.auditLog.create({
              data: {
                userId,
                action: 'CREATE',
                entity: model,
                entityId: result.id,
                newData: JSON.parse(JSON.stringify(result))
              }
            });
          }
          
          return result;
        },
        async update({ model, operation, args, query }) {
          const userId = getAuditUserId();
          
          // Get old data
          const id = args.where?.id;
          let oldData = null;
          if (id && model !== 'AuditLog') {
             oldData = await prismaClient[model.toLowerCase()].findUnique({ where: { id } });
             if (userId && args.data) {
               args.data.updatedBy = userId;
             }
          }

          const result = await query(args);
          
          if (userId && model !== 'AuditLog' && result.id) {
            await prismaClient.auditLog.create({
              data: {
                userId,
                action: 'UPDATE',
                entity: model,
                entityId: result.id,
                oldData: oldData ? JSON.parse(JSON.stringify(oldData)) : null,
                newData: JSON.parse(JSON.stringify(result))
              }
            });
          }
          return result;
        },
        async delete({ model, operation, args, query }) {
          const userId = getAuditUserId();
          
          const id = args.where?.id;
          let oldData = null;
          if (id && model !== 'AuditLog') {
             oldData = await prismaClient[model.toLowerCase()].findUnique({ where: { id } });
          }

          const result = await query(args);
          
          if (userId && model !== 'AuditLog' && result.id) {
            await prismaClient.auditLog.create({
              data: {
                userId,
                action: 'DELETE',
                entity: model,
                entityId: result.id,
                oldData: oldData ? JSON.parse(JSON.stringify(oldData)) : null
              }
            });
          }
          return result;
        }
      }
    }
  });
};
