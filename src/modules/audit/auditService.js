import { getAuditUserId } from '../../middlewares/auditContext.js';

const modelsWithCreatedBy = new Set([
  'Student',
  'Supervisor',
  'Program',
  'Semester',
  'Course',
  'CourseOffering',
  'Center',
  'Room',
  'TimeSlot',
  'Exam',
  'ExamAssignment',
]);

const modelsWithUpdatedBy = new Set([
  'Student',
  'Supervisor',
  'Program',
  'Semester',
  'Course',
  'Center',
  'Room',
  'TimeSlot',
]);

// Convert PascalCase model name to camelCase for Prisma client access
const getPrismaModelAccessor = (model) => {
  return model.charAt(0).toLowerCase() + model.slice(1);
};

// Reusable audit logic pattern
export const applyAuditExtension = (prismaClient) => {
  return prismaClient.$extends({
    query: {
      $allModels: {
        async create({ model, operation, args, query }) {
          const userId = getAuditUserId();
          if (userId && args.data && model !== 'AuditLog' && modelsWithCreatedBy.has(model)) {
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
             const modelAccessor = getPrismaModelAccessor(model);
             oldData = await prismaClient[modelAccessor].findUnique({ where: { id } });
             if (userId && args.data && modelsWithUpdatedBy.has(model)) {
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
             const modelAccessor = getPrismaModelAccessor(model);
             oldData = await prismaClient[modelAccessor].findUnique({ where: { id } });
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
