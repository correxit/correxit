declare const require: any;
jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));
jest.mock('../correxit/workbook', () => ({
  Workbook: { open: jest.fn(() => null) }
}));

import { Rubric } from '../correxit/rubric';
import { Workbook } from '../correxit/workbook';
import { manual } from '../correxit/submitters';

const mock = Workbook.open as unknown as jest.Mock;

const identifier = (
  overrides: Partial<Workbook.Identifier.Assigned> = {}
): Workbook.Identifier.Assigned => ({
  assignee: 'alice@example.com',
  assignment: '',
  issue: 'issue-abc',
  rubric: 'rubric-1',
  ...overrides
});

const notebook = (
  cells: { id: string; source: string }[] = [
    { id: 'c1', source: 'x = 1' },
    { id: 'c2', source: 'print(x)' }
  ]
) => ({
  context: {
    model: {
      sharedModel: {
        toJSON: () => ({
          cells: cells.map(c => ({ id: c.id, source: c.source }))
        })
      }
    }
  }
});

const workbook = (
  submission: Rubric.Timestamp = 1704067200000,
  cells?: { id: string; source: string }[]
) => {
  const assignment: Rubric.Assignment = {
    assignee: 'alice@example.com',
    certification: null,
    collected: null,
    distributed: null,
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
    submission,
    submitted: null
  };
  mock.mockReturnValue({ ...Rubric.create(), assignment });
  return notebook(cells) as unknown as Workbook;
};

describe('manual submitter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a manual:<digest> receipt', async () => {
    const receipt = await manual(workbook(), identifier());
    expect(receipt).toMatch(/^manual:DIGEST<.+>$/);
  });

  it('includes identity and sources in the digest payload', async () => {
    const receipt = await manual(workbook(), identifier());
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload).toMatchObject({
      assignee: 'alice@example.com',
      issue: 'issue-abc',
      rubric: 'rubric-1',
    });
    expect(payload.sources).toBeDefined();
    expect(payload.submission).toBe(1704067200000);
  });

  it('sorts sources by cell id for determinism', async () => {
    const cells = [
      { id: 'z', source: 'last' },
      { id: 'a', source: 'first' }
    ];
    const receipt = await manual(workbook(null, cells), identifier());
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.sources).toEqual([
      ['a', 'first'],
      ['z', 'last']
    ]);
  });

  it('produces identical receipts for identical inputs', async () => {
    const a = await manual(workbook(), identifier());
    const b = await manual(workbook(), identifier());
    expect(a).toBe(b);
  });

  it('produces different receipts for different assignees', async () => {
    const a = await manual(
      workbook(),
      identifier({ assignee: 'alice@example.com' })
    );
    const b = await manual(
      workbook(),
      identifier({ assignee: 'bob@example.com' })
    );
    expect(a).not.toBe(b);
  });

  it('produces different receipts for different sources', async () => {
    const a = await manual(
      workbook(null, [{ id: 'c1', source: 'x = 1' }]),
      identifier()
    );
    const b = await manual(
      workbook(null, [{ id: 'c1', source: 'x = 2' }]),
      identifier()
    );
    expect(a).not.toBe(b);
  });

  it('uses null submission when workbook is not openable', async () => {
    const wb = notebook() as unknown as Workbook;
    mock.mockReturnValue(null);
    const receipt = await manual(wb, identifier());
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.submission).toBeNull();
  });

  it('joins array sources into a single string', async () => {
    const cells = [{ id: 'c1', source: ['line1\n', 'line2'] as any }];
    const wb = {
      context: {
        model: {
          sharedModel: {
            toJSON: () => ({
              cells: cells.map(c => ({ id: c.id, source: c.source }))
            })
          }
        }
      }
    } as unknown as Workbook;
    mock.mockReturnValue({
      ...Rubric.create(),
      assignment: Rubric.create().assignment
    });
    const receipt = await manual(wb, identifier());
    const payload = JSON.parse(receipt.slice('manual:DIGEST<'.length, -1));
    expect(payload.sources[0][1]).toBe('line1\nline2');
  });
});
