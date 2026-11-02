import type { Workbook } from '..';
import * as bridge from '../corrector/bridge';
import type { File } from '../corrector/run';

const workbook = (path: string) => ({ context: { path } }) as Workbook.Headless;
const file = (workbook: Workbook.Headless, points: number): File => ({
  workbook,
  grade: {
    path: workbook.context.path,
    verified: true,
    resolved: true,
    score: {
      id: '',
      code: '',
      comment: '',
      points,
      possible: 5,
      status: 'partial'
    },
    spec: null
  }
});

beforeEach(() => bridge.clear());
afterEach(() => bridge.clear());

it('keeps the snapshot stable when a subscriber republishes unchanged data', () => {
  const empty = bridge.peek();
  bridge.publish({ workbooks: [], grades: new Map() });
  expect(bridge.peek()).toBe(empty);

  const original = file(workbook('first'), 1);
  bridge.publish({
    workbooks: [original.workbook],
    grades: new Map([['first', original]])
  });
  const snapshot = bridge.peek();
  bridge.publish({
    workbooks: [original.workbook],
    grades: new Map([['first', original]])
  });
  expect(bridge.peek()).toBe(snapshot);
});

it('retains a reviewed grade when another batch result arrives', () => {
  const first = file(workbook('first'), 1);
  const second = file(workbook('second'), 2);
  bridge.publish({
    workbooks: [first.workbook],
    grades: new Map([['first', first]])
  });
  const reviewed = file(first.workbook, 4);
  bridge.record(reviewed);
  bridge.publish({
    workbooks: [first.workbook, second.workbook],
    grades: new Map([
      ['first', first],
      ['second', second]
    ])
  });
  expect(bridge.peek().grades.get('first')).toBe(reviewed);
  expect(bridge.peek().grades.get('second')).toBe(second);
});

it('keeps a saving or failed review unverified across batch updates', () => {
  const original = file(workbook('first'), 1);
  const next = {
    workbooks: [original.workbook],
    grades: new Map([['first', original]])
  };
  bridge.publish(next);
  bridge.record({
    ...original,
    grade: { ...original.grade, verified: false, resolved: false }
  });
  bridge.publish(next);
  expect(bridge.peek().grades.get('first')?.grade.verified).toBe(false);
});

it('drops reviewed grades when a new scan replaces their contexts', () => {
  const original = file(workbook('first'), 1);
  bridge.publish({ workbooks: [original.workbook], grades: new Map() });
  bridge.record(original);
  bridge.publish({ workbooks: [workbook('first')], grades: new Map() });
  expect(bridge.peek().grades.size).toBe(0);
  bridge.record(file(original.workbook, 4));
  expect(bridge.peek().grades.size).toBe(0);
});
