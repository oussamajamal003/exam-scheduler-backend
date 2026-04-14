import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { detect } from '../conflicts/service.js';

export const evaluateSchedule = async (scheduleId) => {
  if (!scheduleId) throw new AppError('scheduleId is required', 400);

  const schedule = await prisma.schedule.findUnique({ 
    where: { id: scheduleId },
    include: {
      assignments: {
        include: {
          room: true,
          exam: {
            include: {
              courseOffering: {
                include: {
                  registrations: true
                }
              }
            }
          }
        }
      }
    }
  });
  
  if (!schedule) throw new AppError('Schedule not found', 404);

  // 1. Get Conflicts
  const conflictReport = await detect({ scheduleId });
  const issues = conflictReport.conflicts.map(c => c.description);
  const suggestions = conflictReport.conflicts.map(c => c.suggestedFix);
  let score = 100;

  // Deduct points for conflicts
  const studentConflicts = conflictReport.conflicts.filter(c => c.conflictType === 'STUDENT_CONFLICT').length;
  const roomConflicts = conflictReport.conflicts.filter(c => c.conflictType === 'ROOM_CONFLICT').length;
  const supervisorConflicts = conflictReport.conflicts.filter(c => c.conflictType === 'SUPERVISOR_CONFLICT').length;

  score -= (studentConflicts * 10);
  score -= (roomConflicts * 8);
  score -= (supervisorConflicts * 5);

  // 2. Room Utilization
  let totalCapacity = 0;
  let totalUsed = 0;

  schedule.assignments.forEach(assignment => {
    const capacity = assignment.room?.capacity || 0;
    const expected = assignment.exam?.courseOffering?.expectedStudents || 0;
    const registered = assignment.exam?.courseOffering?.registrations?.length || 0;
    
    // Using actual enrolled students or expected
    const used = Math.max(expected, registered);
    
    totalCapacity += capacity;
    totalUsed += Math.min(used, capacity); // cap at capacity for utilization math
  });

  const roomUtilization = totalCapacity > 0 ? (totalUsed / totalCapacity) : 0;
  
  // Reward good room utilization (sweet spot is 60-85%)
  if (roomUtilization < 0.3) {
    score -= 5;
    issues.push(`Low room utilization (${(roomUtilization * 100).toFixed(1)}%). Many rooms are mostly empty.`);
    suggestions.push('Consider using smaller rooms for these exams.');
  } else if (roomUtilization > 0.9) {
    score -= 2;
    issues.push(`High room utilization (${(roomUtilization * 100).toFixed(1)}%). Rooms are packed.`);
    suggestions.push('Keep an eye on overcrowded rooms.');
  } else if (roomUtilization >= 0.5 && roomUtilization <= 0.85) {
    score += 5; // Bonus for efficient packing
  }

  // 3. Supervisor Load Balance
  // Count exams per supervisor
  const supervisorCounts = {};
  schedule.assignments.forEach(assignment => {
    if (assignment.supervisorId) {
      supervisorCounts[assignment.supervisorId] = (supervisorCounts[assignment.supervisorId] || 0) + 1;
    }
  });

  const counts = Object.values(supervisorCounts);
  if (counts.length > 0) {
    const avgLoad = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Calculate variance
    const variance = counts.reduce((acc, val) => acc + Math.pow(val - avgLoad, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 2) {
      score -= Math.min(10, Math.floor(stdDev * 2)); // penalize high variance
      issues.push(`Supervisor load is unbalanced. Standard deviation is ${stdDev.toFixed(2)} exams per supervisor.`);
      suggestions.push('Redistribute exams among available supervisors more evenly.');
    } else if (stdDev < 1 && counts.length > 1) {
      score += 5; // Bonus for good balance
    }
  }

  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Deduplicate suggestions and issues if there are identical ones
  const uniqueIssues = [...new Set(issues)];
  const uniqueSuggestions = [...new Set(suggestions)];

  return {
    score,
    metrics: {
      studentConflicts,
      roomConflicts,
      supervisorConflicts,
      roomUtilization: parseFloat(roomUtilization.toFixed(3)),
      supervisorLoadStdDev: counts.length > 0 ? parseFloat(Math.sqrt(counts.reduce((acc, val) => acc + Math.pow(val - (counts.reduce((a, b) => a + b, 0) / counts.length), 2), 0) / counts.length).toFixed(2)) : 0
    },
    issues: uniqueIssues,
    suggestions: uniqueSuggestions
  };
};