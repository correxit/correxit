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

import { Collector } from '@correxit/contracts';
import { manual } from '../correxit/collectors';
import { Rubric } from '../correxit/rubric';

const certified = (
  overrides: {
    assignee?: string;
    certification?: Rubric.Timestamp | null;
    issue?: string | null;
    points?: number;
    possible?: number;
    rubric?: string;
  } = {}
): Collector.Payload => {
  const {
    assignee = 'alice@example.com',
    certification = 1704067200000,
    issue = 'issue-abc',
    points = 8,
    possible = 10,
    rubric = 'rubric-1'
  } = overrides;

  return {
    certification,
    file: 'test.ipynb',
    identifier: {
      assignee,
      assignment: '',
      file: 'test.ipynb',
      issue,
      rubric
    },
    name: 'test',
    notebook: {
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5
    },
    path: 'test.ipynb',
    points,
    possible,
    score: {
      code: '',
      comment: '',
      points,
      possible,
      status: 'correct'
    }
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

  it('uses null certification when certification is null', async () => {
    const c = certified({ certification: null });
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
