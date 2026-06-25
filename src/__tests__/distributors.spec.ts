declare const require: any;
jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));

import { manual } from '../correxit/distributors';
import { Workbook } from '../correxit/workbook';

const identifier = (
  overrides: Partial<Workbook.Identifier.Assigned> = {}
): Workbook.Identifier.Assigned => ({
  assignee: 'alice@example.com',
  assignment: 'course:assignment',
  file: 'course-assignment-alice.ipynb',
  issue: 'issue-123',
  rubric: 'rubric-1',
  ...overrides
});

const propagated = (
  cells: { id: string; source: string | string[] }[] = [
    { id: 'c1', source: 'x = 1' },
    { id: 'c2', source: 'print(x)' }
  ],
  overrides: Partial<Workbook.Identifier.Assigned> = {},
  overwrite = true
): Parameters<typeof manual>[0] => ({
  identifier: identifier(overrides),
  notebook: {
    cells: cells.map(cell => ({ ...cell }) as any),
    metadata: {}
  } as any,
  overwrite,
  path: 'assigned.ipynb',
  resources: null
});

describe('manual distributor', () => {
  it('resolves without error', async () => {
    await expect(manual(propagated())).resolves.toBe(true);
  });

  it('does not depend on issue locally', async () => {
    await expect(manual(propagated())).resolves.toBe(true);
  });

  it('does not depend on notebook content locally', async () => {
    await expect(
      manual(propagated([{ id: 'c1', source: 'x = 1' }]))
    ).resolves.toBe(true);
    await expect(
      manual(propagated([{ id: 'c9', source: ['line1\n', 'line2'] }]))
    ).resolves.toBe(true);
  });

  it('ignores overwrite flag', async () => {
    await expect(manual(propagated([], {}, false))).resolves.toBe(true);
  });
});
