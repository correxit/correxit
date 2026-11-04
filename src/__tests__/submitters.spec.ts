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

import { Submitter } from '@correxit/contracts';
import { Rubric } from '../correxit/rubric';
import { Workbook } from '../correxit/workbook';
import { manual } from '../correxit/submitters';

const identifier = (
  overrides: Partial<Workbook.Identifier.Assigned> = {}
): Workbook.Identifier.Assigned => ({
  assignee: 'alice@example.com',
  assignment: '',
  file: 'assignment-alice.ipynb',
  issue: 'issue-abc',
  rubric: 'rubric-1',
  ...overrides
});

const submitted = (
  overrides: {
    cells?: { id: string; source: string | string[] }[];
    identifier?: Partial<Workbook.Identifier.Assigned>;
    submission?: Rubric.Timestamp | null;
  } = {}
): Submitter.Payload => ({
  file: overrides.identifier?.file ?? 'assignment-alice.ipynb',
  identifier: identifier(overrides.identifier),
  name: 'assignment',
  notebook: {
    cells: (overrides.cells ?? [
      { cell_type: 'code', id: 'c1', metadata: {}, source: 'x = 1' },
      { cell_type: 'code', id: 'c2', metadata: {}, source: 'print(x)' }
    ]) as any,
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5
  },
  path: 'assignment-alice.ipynb',
  submission:
    overrides.submission !== undefined ? overrides.submission : 1704067200000
});

describe('manual submitter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a manual:<digest> receipt', async () => {
    const receipt = await manual(submitted());
    expect(receipt).toMatch(/^manual:DIGEST<.+>$/);
  });

  it('includes identity and sources in the digest payload', async () => {
    const receipt = await manual(submitted());
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload).toMatchObject({
      assignee: 'alice@example.com',
      issue: 'issue-abc',
      rubric: 'rubric-1'
    });
    expect(payload.sources).toBeDefined();
    expect(payload.submission).toBe(1704067200000);
  });

  it('sorts sources by cell id for determinism', async () => {
    const cells = [
      { id: 'z', source: 'last' },
      { id: 'a', source: 'first' }
    ];
    const receipt = await manual(submitted({ cells }));
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.sources).toEqual([
      ['a', 'first'],
      ['z', 'last']
    ]);
  });

  it('produces identical receipts for identical inputs', async () => {
    const a = await manual(submitted());
    const b = await manual(submitted());
    expect(a).toBe(b);
  });

  it('produces different receipts for different assignees', async () => {
    const a = await manual(
      submitted({ identifier: { assignee: 'alice@example.com' } })
    );
    const b = await manual(
      submitted({ identifier: { assignee: 'bob@example.com' } })
    );
    expect(a).not.toBe(b);
  });

  it('produces different receipts for different sources', async () => {
    const a = await manual(
      submitted({ cells: [{ id: 'c1', source: 'x = 1' }] })
    );
    const b = await manual(
      submitted({ cells: [{ id: 'c1', source: 'x = 2' }] })
    );
    expect(a).not.toBe(b);
  });

  it('uses null submission when submission is null', async () => {
    const receipt = await manual(submitted({ submission: null }));
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.submission).toBeNull();
  });

  it('joins array sources into a single string', async () => {
    const cells = [{ id: 'c1', source: ['line1\n', 'line2'] }];
    const receipt = await manual(submitted({ cells }));
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.sources[0][1]).toBe('line1\nline2');
  });
});
