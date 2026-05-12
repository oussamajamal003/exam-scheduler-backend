import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { getScheduleAnalysis } from '../scheduling/schedulingService.js';

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

  const analysis = await getScheduleAnalysis(scheduleId);
  const derived = analysis.conflicts?.derived ?? {};
  const issues = [];
  const suggestions = [];
  let score = 100;

  const studentConflicts = (derived.studentOverlaps ?? []).length;
  const roomConflicts = (derived.roomReuseViolations ?? []).length + (derived.roomCapacityViolations ?? []).length;
  const proctorConflicts = (derived.proctorConflicts ?? []).length + (derived.proctorDailyLoadViolations ?? []).length;

  score -= (studentConflicts * 10);
  score -= (roomConflicts * 8);
  score -= (proctorConflicts * 5);

  if (studentConflicts > 0) {
    issues.push(`${studentConflicts} student overlap issue${studentConflicts === 1 ? '' : 's'} remain in the schedule.`);
    suggestions.push('Move overlapping exams to different time slots or widen spacing between shared-student exams.');
  }
  if (roomConflicts > 0) {
    issues.push(`${roomConflicts} room-capacity or room-reuse issue${roomConflicts === 1 ? '' : 's'} remain in the schedule.`);
    suggestions.push('Rebalance rooms so each exam has enough seats without reusing a room in overlapping time windows.');
  }
  if (proctorConflicts > 0) {
    issues.push(`${proctorConflicts} proctor assignment issue${proctorConflicts === 1 ? '' : 's'} remain in the schedule.`);
    suggestions.push('Redistribute invigilation coverage so no proctor overlaps or exceeds daily workload limits.');
  }

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

  // 3. Proctor Load Balance
  // Count exams per proctor
  const proctorCounts = {};
  schedule.assignments.forEach(assignment => {
    if (assignment.proctorId) {
      proctorCounts[assignment.proctorId] = (proctorCounts[assignment.proctorId] || 0) + 1;
    }
  });

  const counts = Object.values(proctorCounts);
  if (counts.length > 0) {
    const avgLoad = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Calculate variance
    const variance = counts.reduce((acc, val) => acc + Math.pow(val - avgLoad, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 2) {
      score -= Math.min(10, Math.floor(stdDev * 2)); // penalize high variance
      issues.push(`Proctor load is unbalanced. Standard deviation is ${stdDev.toFixed(2)} exams per proctor.`);
      suggestions.push('Redistribute exams among available proctors more evenly.');
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
      proctorConflicts,
      roomUtilization: parseFloat(roomUtilization.toFixed(3)),
      proctorLoadStdDev: counts.length > 0 ? parseFloat(Math.sqrt(counts.reduce((acc, val) => acc + Math.pow(val - (counts.reduce((a, b) => a + b, 0) / counts.length), 2), 0) / counts.length).toFixed(2)) : 0,
      totalHardConstraintIssues: analysis.metrics?.totalConflicts ?? 0,
    },
    issues: uniqueIssues,
    suggestions: uniqueSuggestions
  };
};