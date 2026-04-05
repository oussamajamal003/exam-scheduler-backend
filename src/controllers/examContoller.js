import prisma from '../config/prisma';

// 1. Fetch exam schedule with relations
export const getExamSchedules = async (req, res) => {
  try {
    const exams = await prisma.exam.findMany({
      include: {
        courseOffering: {
          include: { course: true }
        },
        timeSlot: true,
        examRoomAssignments: {
          include: { 
            room: {
              include: { center: true } // Fetches the center
            } 
          }
        },
        supervisorAssignments: {
          include: { supervisor: true }
        }
      },
    });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. Fetch student exams joined through enrollments
export const getStudentExams = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await prisma.student.findUnique({
      where: { id: parseInt(studentId) },
      include: {
        registrations: {
          include: {
            courseOffering: {
              include: {
                course: true,
                exams: {
                  include: { timeSlot: true }
                }
              }
            }
          }
        }
      }
    });

    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};