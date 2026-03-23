declare const require: any;
jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));
jest.mock('../correxit/workbook', () => ({
  Workbook: { open: jest.fn(() => null) }
}));
jest.mock('../plugins', () => ({ plugins: [] }));

import { Rubric } from '../correxit/rubric';
import { Workbook } from '../correxit/workbook';
import { generate } from '../corrector/csv';
import type { Scanned } from '../corrector/commands';

type Grade = {
  path: string;
  resolved: boolean;
  score: Rubric.Score;
  spec: null;
};
type Headless = { content: null; context: { path: string } };

const BOM = '\uFEFF';
const header =
  'assignee,assignment,expiration,title,rubric,' +
  'issue,points,possible,' +
  'submission,submitted,certification,collected,' +
  'resolved,path';

const report = (): Rubric.Assignment.Report => ({
  interventions: {},
  kernel: null,
  scores: {}
});

const assignment = (
  overrides: Partial<Rubric.Assignment> = {}
): Rubric.Assignment => ({
  assignee: '',
  certification: null,
  collected: null,
  distributed: null,
  expiration: null,
  id: null,
  issue: '',
  issuer: '',
  keys: Rubric.Assignment.Keys.empty(),
  mac: '',
  name: '',
  report: report(),
  roster: [],
  seal: null,
  submission: null,
  submitted: null,
  ...overrides
});

const rubric = (overrides: Partial<Rubric.Unlocked> = {}): Rubric.Unlocked => ({
  assignment: assignment(),
  cells: {},
  id: 'rubric-1',
  key: 'k',
  locked: false,
  references: {},
  revised: 0,
  ...overrides
});

const workbook = (path: string): Headless =>
  ({ content: null, context: { path } }) as unknown as Headless;

const hollow = (path: string): Scanned =>
  ({ hollow: true, context: { path } }) as Scanned;

function grade(path: string, score: Rubric.Score, resolved = true): Grade {
  return { path, resolved, score, spec: null };
}

const parse = (output: string) => {
  const raw = output.startsWith(BOM) ? output.slice(1) : output;
  return raw.split('\r\n').map(line => {
    const fields: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  });
};

const mock = Workbook.open as jest.Mock;
beforeEach(() => mock.mockReturnValue(null));
afterEach(() => mock.mockReset());

describe('csv', () => {
  it('returns header-only output for empty workbooks', () => {
    const output = generate([], new Map());
    expect(output).toBe(BOM + header);
  });

  it('skips hollow workbooks', () => {
    const output = generate([hollow('a.ipynb')], new Map());
    expect(output).toBe(BOM + header);
  });

  it('produces a row for a reified workbook with no rubric', () => {
    const wb = workbook('dir/student.ipynb');
    mock.mockReturnValue(null);
    const rows = parse(generate([wb as unknown as Scanned], new Map()));
    expect(rows).toHaveLength(2);
    const [, row] = rows;
    expect(row[0]).toBe('');
    expect(row[row.length - 1]).toBe('dir/student.ipynb');
    expect(row[6]).toBe('');
    expect(row[7]).toBe('');
  });

  it('populates identity fields from rubric', () => {
    const wb = workbook('hw/alice.ipynb');
    mock.mockReturnValue(
      rubric({
        id: 'r-42',
        assignment: assignment({
          assignee: 'Alice',
          id: 'hw-1',
          issue: 'issue-abc',
          name: 'Homework 1',
        })
      })
    );
    const rows = parse(generate([wb as unknown as Scanned], new Map()));
    const [, row] = rows;
    expect(row[0]).toBe('Alice');
    expect(row[1]).toBe('hw-1');
    expect(row[3]).toBe('Homework 1');
    expect(row[4]).toBe('r-42');
    expect(row[5]).toBe('issue-abc');
  });

  it('uses grade score when provided', () => {
    const wb = workbook('hw/bob.ipynb');
    mock.mockReturnValue(
      rubric({
        assignment: assignment({ assignee: 'Bob' })
      })
    );
    const score: Rubric.Score = {
      code: '',
      comment: '',
      id: '',
      points: 8,
      possible: 10,
      status: 'correct'
    };
    const grades = new Map([
      ['hw/bob.ipynb', { grade: grade('hw/bob.ipynb', score) }]
    ]);
    const rows = parse(generate([wb as unknown as Scanned], grades));
    const [, row] = rows;
    expect(row[6]).toBe('8');
    expect(row[7]).toBe('10');
    expect(row[12]).toBe('true');
  });

  it('falls back to rubric summary when no grade exists', () => {
    const wb = workbook('hw/carol.ipynb');
    const scores: Record<string, Rubric.Score> = {
      'cell-1': {
        code: '',
        comment: '',
        id: 'cell-1',
        points: 3,
        possible: 5,
        status: 'correct'
      }
    };
    mock.mockReturnValue(
      rubric({
        assignment: assignment({ report: { ...report(), scores } })
      })
    );
    const rows = parse(generate([wb as unknown as Scanned], new Map()));
    const [, row] = rows;
    expect(row[6]).toBe('3');
    expect(row[7]).toBe('5');
  });

  it('escapes commas in fields', () => {
    const wb = workbook('hw/student.ipynb');
    mock.mockReturnValue(
      rubric({
        assignment: assignment({ name: 'Last, First' })
      })
    );
    const output = generate([wb as unknown as Scanned], new Map());
    expect(output).toContain('"Last, First"');
    const rows = parse(output);
    expect(rows[1][3]).toBe('Last, First');
  });

  it('escapes double quotes in fields', () => {
    const wb = workbook('hw/student.ipynb');
    mock.mockReturnValue(
      rubric({
        assignment: assignment({ name: 'Say "hello"' })
      })
    );
    const output = generate([wb as unknown as Scanned], new Map());
    expect(output).toContain('"Say ""hello"""');
  });

  it('sanitizes formula injection characters', () => {
    const wb = workbook('hw/evil.ipynb');
    mock.mockReturnValue(
      rubric({
        assignment: assignment({ assignee: '=CMD()' })
      })
    );
    const rows = parse(generate([wb as unknown as Scanned], new Map()));
    expect(rows[1][0]).toBe("'=CMD()");
  });

  it('sanitizes plus, minus, at, and tab prefixes', () => {
    for (const prefix of ['+', '-', '@', '\t']) {
      const wb = workbook('hw/x.ipynb');
      mock.mockReturnValue(
        rubric({
          assignment: assignment({ assignee: `${prefix}payload` })
        })
      );
      const rows = parse(generate([wb as unknown as Scanned], new Map()));
      expect(rows[1][0]).toBe(`'${prefix}payload`);
    }
  });

  it('starts with a UTF-8 BOM', () => {
    const output = generate([], new Map());
    expect(output.charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings', () => {
    const wb = workbook('hw/a.ipynb');
    mock.mockReturnValue(null);
    const output = generate([wb as unknown as Scanned], new Map());
    const raw = output.slice(1);
    expect(raw.split('\r\n')).toHaveLength(2);
  });

  it('includes lifecycle timestamps when present', () => {
    const wb = workbook('hw/dated.ipynb');
    mock.mockReturnValue(
      rubric({
        assignment: assignment({
          certification: 1700000000000,
          collected: 'receipt-abc',
          submission: 1699000000000,
          submitted: 'sub-xyz'
        })
      })
    );
    const rows = parse(generate([wb as unknown as Scanned], new Map()));
    const [, row] = rows;
    expect(row[8]).not.toBe('');
    expect(row[10]).not.toBe('');
    expect(row[9]).toBe('sub-xyz');
    expect(row[11]).toBe('receipt-abc');
  });

  it('handles multiple workbooks mixing hollow and reified', () => {
    const a = hollow('a.ipynb');
    const b = workbook('b.ipynb');
    const c = hollow('c.ipynb');
    const d = workbook('d.ipynb');
    mock.mockReturnValue(null);
    const rows = parse(
      generate([a, b, c, d] as unknown as Scanned[], new Map())
    );
    expect(rows).toHaveLength(3);
    expect(rows[1][rows[1].length - 1]).toBe('b.ipynb');
    expect(rows[2][rows[2].length - 1]).toBe('d.ipynb');
  });
});
