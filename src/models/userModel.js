import prisma from '../config/prisma.js';

// Model Wrappers (Data Access Layer / Repository Pattern)
// These functions abstract the direct Prisma ORM calls away from the business logic services.

export const findUserByEmail = async (email) => {
  return await prisma.user.findUnique({
    where: { email },
  });
};

export const createUser = async (userData) => {
  // If the user is a student or supervisor, we might eventually want to auto-create
  // empty student/supervisor records here or in a separate endpoint.
  // For now, simply create the user object based on the schema's Role enum.
  return await prisma.user.create({
    data: userData,
  });
};

export const findAllUsers = async () => {
  return await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });
};

export const deleteUserById = async (id) => {
  return await prisma.user.delete({
    where: { id },
  });
};
