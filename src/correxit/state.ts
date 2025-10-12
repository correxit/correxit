import { Correxit, Rubric, Workbook } from '.';

const current: { workbook: Workbook | null } = { workbook: null };

export function workbook(update?: Workbook | null) {
  return current.workbook = update ?? current.workbook
}

export function cell(args: Partial<
  Rubric.Cell & Rubric.Cell.Toolbar
>): Rubric.Cell['id'] {
  const notebook = workbook()?.content;
  const toolbar = args[Rubric.Cell.TOOLBAR];
  return args.id || toolbar && notebook?.activeCell?.model.id || '';
}

export async function subscribe(source: Correxit.Source) {
  for await (const { payload } of source) {
    workbook(payload);
  }
}
