import type { Workbook } from '..';
import type { File } from '../corrector/run';
import * as session from '../corrector/session';

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
const read = (workbook: Workbook.Headless, run = 'run') =>
  session.advance(run, {
    type: 'read',
    path: workbook.context.path,
    workbook,
    error: null
  });
const result = (file: File, run = 'run') =>
  session.advance(run, {
    type: 'result',
    path: file.workbook.context.path,
    file,
    completed: true
  });

beforeEach(() => session.begin('run', 'grade'));
afterEach(() => session.clear(session.peek().run!));

it('retains a manual review when another batch result arrives', () => {
  const first = file(workbook('first'), 1);
  const second = file(workbook('second'), 2);
  session.advance('run', { type: 'listed', paths: ['first', 'second'] });
  read(first.workbook);
  read(second.workbook);
  result(first);
  const reviewed = file(first.workbook, 4);
  session.record(reviewed);
  const entry = session.peek().entries.get('first');
  result(second);
  expect(session.peek().entries.get('first')).toBe(entry);
  expect(entry?.grade).toBe(reviewed.grade);
  expect(session.peek().entries.get('second')?.grade).toBe(second.grade);
  expect(session.peek().progress.completed).toBe(2);
});

it('keeps a saving or failed review unverified while the batch continues', () => {
  const first = file(workbook('first'), 1);
  const second = file(workbook('second'), 2);
  session.advance('run', { type: 'listed', paths: ['first', 'second'] });
  read(first.workbook);
  read(second.workbook);
  result(first);
  session.record({
    ...first,
    grade: { ...first.grade, verified: false, resolved: false }
  });
  result(second);
  session.advance('run', { type: 'done', stopped: false });
  expect(session.peek().entries.get('first')?.grade?.verified).toBe(false);
});

it('rejects old results, reviews, and releases after a new scan of the same path', () => {
  const original = file(workbook('first'), 1);
  session.advance('run', { type: 'listed', paths: ['first'] });
  read(original.workbook);
  result(original);

  session.begin('next', 'scan');
  session.advance('next', { type: 'listed', paths: ['first'] });
  const fresh = workbook('first');
  read(fresh, 'next');
  const snapshot = session.peek();
  result(original);
  session.advance('run', { type: 'done', stopped: true });
  session.record(file(original.workbook, 4));
  session.clear('run');
  expect(session.peek()).toBe(snapshot);
  expect(snapshot.entries.get('first')?.workbook).toBe(fresh);
  expect(snapshot.entries.get('first')?.grade).toBeNull();
});

it('makes finished contexts reviewable while withholding active work', () => {
  const first = file(workbook('first'), 1);
  const second = file(workbook('second'), 2);
  session.advance('run', { type: 'listed', paths: ['first', 'second'] });
  read(first.workbook);
  read(second.workbook);
  session.advance('run', { type: 'started', path: 'first' });
  expect(session.available(session.peek())).toHaveLength(0);
  result(first);
  expect(
    session.available(session.peek()).map(entry => entry.workbook)
  ).toEqual([first.workbook]);
  session.advance('run', { type: 'done', stopped: true });
  expect(
    session.available(session.peek()).map(entry => entry.workbook)
  ).toEqual([first.workbook, second.workbook]);
  expect(session.peek().entries.get('second')?.grade).toBeNull();
});

it('keeps scan results unverified and available without grading', () => {
  session.begin('run', 'scan');
  const scanned = workbook('first');
  session.advance('run', { type: 'listed', paths: ['first'] });
  read(scanned);
  expect(
    session.available(session.peek()).map(entry => entry.workbook)
  ).toEqual([scanned]);
  expect(session.peek().entries.get('first')?.grade).toBeNull();
});

it('counts unreadable, ordinary, failed, and skipped workbooks independently', () => {
  session.begin('run', 'collect');
  session.advance('run', {
    type: 'listed',
    paths: ['unreadable', 'ordinary', 'failed', 'skipped']
  });
  session.advance('run', {
    type: 'read',
    path: 'unreadable',
    workbook: null,
    error: 'read'
  });
  session.advance('run', {
    type: 'read',
    path: 'ordinary',
    workbook: null,
    error: null
  });
  read(workbook('failed'));
  session.advance('run', {
    type: 'error',
    path: 'failed',
    message: 'authenticate'
  });
  const skipped = file(workbook('skipped'), 3);
  read(skipped.workbook);
  session.advance('run', {
    type: 'result',
    path: 'skipped',
    file: skipped,
    completed: false
  });
  session.advance('run', { type: 'done', stopped: false });
  expect(session.peek().progress).toEqual({
    total: 4,
    checked: 4,
    completed: 0,
    finished: 4,
    skipped: 2,
    failed: 2,
    listed: true,
    done: true,
    stopped: false,
    error: false
  });
  expect(Array.from(session.peek().entries.keys())).toEqual([
    'unreadable',
    'failed',
    'skipped'
  ]);
  expect(session.peek().entries.get('failed')).toMatchObject({
    grade: null,
    error: 'authenticate'
  });
});

it('clears retained results on release and ignores a late review', () => {
  const original = file(workbook('first'), 1);
  read(original.workbook);
  result(original);
  session.clear('run');
  session.record(original);
  expect(session.peek()).toBe(session.empty);
});

it('does not replace results when only the reviewer cursor changes', () => {
  const original = file(workbook('first'), 1);
  read(original.workbook);
  result(original);
  const entries = session.peek().entries;
  session.navigate({ path: 'first', cell: 'answer' });
  expect(session.peek().entries).toBe(entries);
});
