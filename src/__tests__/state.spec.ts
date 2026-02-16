declare const require: any;
jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));
jest.mock('../correxit/workbook', () => ({ Workbook: { open: jest.fn() } }));

import { Rubric } from '../correxit/rubric';
import { Workbook } from '../correxit/workbook';
import * as state from '../correxit/state';

// We need to type-cast the mocked module to access the mock function
const MockWorkbook = Workbook as unknown as { open: jest.Mock };

describe('state', () => {
  const dummy: any = { context: { path: 'dummy.ipynb' } }; // Workbook mock
  const score: Rubric.Score = {
    ...Rubric.Score.CORRECT,
    code: '',
    points: 10,
    possible: 10
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // We can't easily reset the module-level 'report' Map without reloading the
    // module, but we can ensure test isolation by using unique rubric IDs.
  });

  describe('cache & report', () => {
    it('does not cache if workbook cannot be opened', () => {
      MockWorkbook.open.mockReturnValue(null);
      state.cache(dummy, 'cell-1', score);
      expect(state.report(dummy, 'cell-1')).toBeNull();
    });

    it('returns null if workbook is not openable', () => {
      MockWorkbook.open.mockReturnValue(null);
      expect(state.report(dummy, 'cell-1')).toBeNull();
    });

    it('returns null if cell is not scored in rubric and not in cache', () => {
      const start = Rubric.create();
      MockWorkbook.open.mockReturnValue(start);
      expect(state.report(dummy, 'cell-1')).toBeNull();
    });

    it('returns persisted score from rubric if not in cache', () => {
      const assignment = {
        ...Rubric.create().assignment,
        report: { scores: { 'cell-1': score } } as any
      };
      const rubric = { ...Rubric.create(), assignment };
      MockWorkbook.open.mockReturnValue(rubric);

      expect(state.report(dummy, 'cell-1')).toEqual(score);
    });

    it('caches score after reading from rubric', () => {
      const assignment = {
        ...Rubric.create().assignment,
        report: { scores: { 'cell-1': score } } as any
      };
      const rubric = { ...Rubric.create(), assignment };
      MockWorkbook.open.mockReturnValue(rubric);
      state.report(dummy, 'cell-1');

      const altered = {
        ...rubric,
        assignment: { ...rubric.assignment, report: { scores: {} } as any }
      };
      MockWorkbook.open.mockReturnValue(altered);
      expect(state.report(dummy, 'cell-1')).toEqual(score);
    });

    it('retrieves explicitly cached scores', () => {
      const rubric = Rubric.create();
      MockWorkbook.open.mockReturnValue(rubric);

      state.cache(dummy, 'cell-2', score);
      expect(state.report(dummy, 'cell-2')).toEqual(score);
    });

    it('uses composite key including assignee', () => {
      const base = Rubric.create();
      const rubric1 = {
        ...base,
        assignment: { ...base.assignment, assignee: 'alice' }
      };
      const rubric2 = {
        ...base,
        assignment: { ...base.assignment, assignee: 'bob' }
      };

      MockWorkbook.open.mockReturnValue(rubric1);
      state.cache(dummy, 'cell-1', { ...score, points: 1 });

      MockWorkbook.open.mockReturnValue(rubric2);
      state.cache(dummy, 'cell-1', { ...score, points: 2 });

      MockWorkbook.open.mockReturnValue(rubric1);
      expect(state.report(dummy, 'cell-1')?.points).toBe(1);

      MockWorkbook.open.mockReturnValue(rubric2);
      expect(state.report(dummy, 'cell-1')?.points).toBe(2);
    });
  });

  describe('eviction policy', () => {
    it('evicts oldest entries when cache exceeds footprint', () => {
      // Create a specific rubric ID for this test to isolate completely
      const rubric = { ...Rubric.create(), id: 'eviction-test' };
      MockWorkbook.open.mockReturnValue(rubric);

      for (let i = 0; i < state.footprint; i++) {
        state.cache(dummy, `cell-${i}`, score);
      }
      expect(state.report(dummy, 'cell-0')).toEqual(score);
      state.cache(dummy, `cell-${state.footprint}`, score);
      expect(state.report(dummy, 'cell-0')).toBeNull();
      expect(state.report(dummy, `cell-${state.footprint}`)).toEqual(score);
    });
  });

  describe('workbook', () => {
    it('gets and sets the active workbook', () => {
      expect(state.workbook()).toBeNull();
      state.workbook(dummy);
      expect(state.workbook()).toBe(dummy);
      state.workbook(null);
      expect(state.workbook()).toBeNull();
    });
  });

  describe('cell', () => {
    it('returns id if provided explicitly', () => {
      expect(state.cell({ id: 'explicit-id' })).toBe('explicit-id');
    });

    it('returns active cell id if toolbar flag is set', () => {
      const activeCell = { model: { id: 'active-id' } };
      const content = { activeCell };
      const wb = { ...dummy, content };
      state.workbook(wb);
      expect(state.cell({ [Rubric.Cell.TOOLBAR]: true })).toBe('active-id');
    });

    it('returns empty string if toolbar set but no active cell', () => {
      state.workbook({ ...dummy, content: null });
      expect(state.cell({ [Rubric.Cell.TOOLBAR]: true })).toBe('');
    });

    it('returns empty string if neither id nor toolbar flag provided', () => {
      state.workbook(dummy);
      expect(state.cell({})).toBe('');
    });
  });
});
