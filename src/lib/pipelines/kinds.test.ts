import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAGES_BY_KIND,
  firstFinalStage,
  isPipelineKind,
  pipelineKind,
  stageProbability,
} from './kinds';

const st = (id: string, position: number, outcome: 'won' | 'lost' | null = null) => ({
  id,
  position,
  outcome,
});

describe('defaults', () => {
  it('sales ends with Won and Lost final stages', () => {
    const s = DEFAULT_STAGES_BY_KIND.sales;
    expect(s.slice(-2).map((x) => x.outcome)).toEqual(['won', 'lost']);
  });
  it('support has Resolved (won) and Closed (lost)', () => {
    const finals = DEFAULT_STAGES_BY_KIND.support.filter((x) => x.outcome);
    expect(finals.map((x) => [x.name, x.outcome])).toEqual([
      ['Resolved', 'won'],
      ['Closed', 'lost'],
    ]);
  });
  it('kind helpers', () => {
    expect(isPipelineKind('support')).toBe(true);
    expect(isPipelineKind('tickets')).toBe(false);
    expect(pipelineKind({})).toBe('sales');
    expect(pipelineKind({ kind: 'support' })).toBe('support');
  });
});

describe('firstFinalStage', () => {
  it('picks the lowest-position stage with that outcome', () => {
    const stages = [st('a', 0), st('closed', 4, 'lost'), st('done', 3, 'won'), st('refund', 5, 'won')];
    expect(firstFinalStage(stages, 'won')?.id).toBe('done');
    expect(firstFinalStage(stages, 'lost')?.id).toBe('closed');
    expect(firstFinalStage([st('a', 0)], 'won')).toBeUndefined();
  });
});

describe('stageProbability', () => {
  it('keeps the old rule when no stage is final', () => {
    const stages = [st('a', 0), st('b', 1), st('c', 2), st('won', 3)];
    expect(stageProbability(stages, 'won')).toBe(1);
    expect(stageProbability(stages, 'a')).toBeCloseTo(0.1);
    expect(stageProbability(stages, 'c')).toBeCloseTo(0.9);
  });
  it('uses outcomes when final stages exist', () => {
    const stages = [st('a', 0), st('b', 1), st('won', 2, 'won'), st('lost', 3, 'lost')];
    expect(stageProbability(stages, 'won')).toBe(1);
    expect(stageProbability(stages, 'lost')).toBe(0);
    expect(stageProbability(stages, 'a')).toBeCloseTo(0.1);
    expect(stageProbability(stages, 'b')).toBeCloseTo(0.9);
    expect(stageProbability(stages, 'missing')).toBe(0);
  });
});
