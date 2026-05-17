// Category 5 — Optimization & Evaluation
// Verifies the engine reports valid evaluation metrics, runs at least one
// optimization strategy, and produces a schedule whose post-evaluation
// hard-conflict count is exactly zero.

import {
  generateSchedule,
  optimizeScheduling,
  getScheduleAnalysis,
} from '../../src/modules/scheduling/schedulingService.js';
import { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

describe('Hybrid Scheduler — Optimization & Evaluation (FEIT Spring 2026)', () => {
  let scenario;
  let generated;
  let analysis;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-S5' });
    generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'FEIT S5 Optimization',
    });
    analysis = await getScheduleAnalysis(generated.scheduleId);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('exposes before/after quality scores with valid bounds', () => {
    const { algorithm } = generated;
    expect(typeof algorithm.beforeScore).toBe('number');
    expect(typeof algorithm.afterScore).toBe('number');
    expect(algorithm.beforeScore).toBeGreaterThanOrEqual(0);
    expect(algorithm.afterScore).toBeGreaterThanOrEqual(0);
    expect(algorithm.beforeScore).toBeLessThanOrEqual(100);
    expect(algorithm.afterScore).toBeLessThanOrEqual(100);
    // Optimization should never produce a worse outcome than the initial draft.
    expect(algorithm.afterScore).toBeGreaterThanOrEqual(algorithm.beforeScore - 0.01);
  });

  it('exposes qualityMetrics dimensions used by the evaluator', () => {
    const metrics = generated.algorithm.qualityMetrics ?? {};
    // The evaluator emits at least one named metric.
    expect(Object.keys(metrics).length).toBeGreaterThan(0);
    for (const value of Object.values(metrics)) {
      // Each metric should be either a number or an object with a numeric score.
      if (typeof value === 'number') {
        expect(Number.isFinite(value)).toBe(true);
      } else if (value && typeof value === 'object') {
        if ('score' in value) expect(typeof value.score).toBe('number');
      }
    }
  });

  it('reports an improvementLabel and a numeric improvementPercentage', () => {
    expect(typeof generated.algorithm.improvementLabel).toBe('string');
    expect(generated.algorithm.improvementLabel.length).toBeGreaterThan(0);
    expect(typeof generated.algorithm.improvementPercentage).toBe('number');
    expect(Number.isFinite(generated.algorithm.improvementPercentage)).toBe(true);
  });

  it('analysis confirms zero hard-constraint conflicts after optimization', () => {
    expect(analysis.metrics.totalConflicts).toBe(0);
    expect(analysis.metrics.derivedConflicts).toBe(0);
    expect(analysis.metrics.totalAssignments).toBe(generated.assignmentsCount);
    expect(analysis.metrics.averageRoomUtilization).toBeGreaterThan(0);
    expect(analysis.metrics.averageRoomUtilization).toBeLessThanOrEqual(1);
  });

  it('optimizeScheduling reports beforeScore <= afterScore and includes attemptedStrategies', async () => {
    const result = await optimizeScheduling({ semesterId: scenario.semester.id });
    expect(result.optimization.attempted).toBe(true);
    expect(typeof result.optimization.beforeScore).toBe('number');
    expect(typeof result.optimization.afterScore).toBe('number');
    expect(result.optimization.afterScore).toBeGreaterThanOrEqual(result.optimization.beforeScore - 0.01);
    expect(Array.isArray(result.optimization.attemptedStrategies)).toBe(true);
    expect(result.optimization.attemptedStrategies.length).toBeGreaterThanOrEqual(1);
  });
});
