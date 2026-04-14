declare const require: any;
jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));
jest.mock('../correxit/workbook', () => ({
  Workbook: {
    headed: (workbook: { content?: unknown } | null) => !!workbook?.content,
    headless: (workbook: { content?: unknown } | null) =>
      !!workbook && workbook.content === null,
    open: jest.fn(() => null)
  }
}));
jest.mock('../plugins', () => ({ plugins: [] }));

import { manual } from '../correxit/collectors';
import { Rubric } from '../correxit/rubric';
import { Workbook } from '../correxit/workbook';

const certified = (
  overrides: {
    assignee?: string;
    certification?: Rubric.Timestamp;
    issue?: string | null;
    points?: number;
    possible?: number;
    rubric?: string;
  } = {}
): Workbook.Certified => {
  const {
    assignee = 'alice@example.com',
    certification = 1704067200000,
    issue = 'issue-abc',
    points = 8,
    possible = 10,
    rubric = 'rubric-1'
  } = overrides;

  const assignment: Rubric.Assignment = {
    assignee,
    certification,
    collected: null,
    distribution: null,
    expiration: null,
    id: '',
    issue: '',
    issuer: '',
    keys: Rubric.Assignment.Keys.empty(),
    mac: '',
    name: '',
    report: Rubric.Assignment.Report.empty(),
    roster: [],
    seal: null,
    submission: null,
    submitted: null
  };

  (Workbook.open as jest.Mock).mockReturnValue({
    ...Rubric.create(),
    assignment
  });

  return {
    grade: {
      path: 'test.ipynb',
      resolved: true,
      score: { ...Rubric.Score.CORRECT, points, possible },
      spec: null
    },
    identifier: { assignee, assignment: '', issue, rubric },
    workbook: {} as Workbook
  };
};

describe('manual collector', () => {
  it('returns a deterministic digest receipt', async () => {
    const receipt = await manual(certified());
    expect(receipt).toMatch(/^manual:DIGEST<.+>$/);
  });

  it('includes all expected fields in the digest payload', async () => {
    const receipt = await manual(certified());
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload).toEqual({
      assignee: 'alice@example.com',
      certification: 1704067200000,
      issue: 'issue-abc',
      points: 8,
      possible: 10,
      rubric: 'rubric-1'
    });
  });

  it('uses null certification when workbook is not openable', async () => {
    const c = certified();
    (Workbook.open as jest.Mock).mockReturnValue(null);
    const receipt = await manual(c);
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.certification).toBeNull();
  });

  it('produces identical receipts for identical inputs', async () => {
    const a = await manual(certified());
    const b = await manual(certified());
    expect(a).toBe(b);
  });

  it('produces different receipts for different assignees', async () => {
    const a = await manual(certified({ assignee: 'alice@example.com' }));
    const b = await manual(certified({ assignee: 'bob@example.com' }));
    expect(a).not.toBe(b);
  });

  it('produces different receipts for different scores', async () => {
    const a = await manual(certified({ points: 8 }));
    const b = await manual(certified({ points: 5 }));
    expect(a).not.toBe(b);
  });
});
