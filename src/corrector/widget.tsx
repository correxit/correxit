import { MainAreaWidget } from '@jupyterlab/apputils';
import { CodeEditor, IEditorMimeTypeService } from '@jupyterlab/codeeditor';
import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime, IRenderMimeRegistry } from '@jupyterlab/rendermime';
import {
  CommandToolbarButton,
  ReactWidget,
  Toolbar
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { UUID } from '@lumino/coreutils';
import React from 'react';
import { Correxit, Rubric, Workbook } from '../correxit';
import * as state from '../correxit/state';
import { Boundary } from '../ui';
import { Corrector } from '.';
import * as bridge from './bridge';
import { CommandIDs, Scanned } from './commands';
import { Reviewer } from './reviewer';

export class CorrectorWidget extends MainAreaWidget<CorrectorContent> {
  constructor({ commands, indicator, path, trans }: CorrectorWidget.IOptions) {
    super({
      content: new CorrectorContent({ commands, path, trans }),
      toolbar: new Toolbar({ noFocusOnClick: true })
    });
    this.commands = commands;
    this.indicator = indicator;
    this.trans = trans;
    this.addClass('correxit-corrector-widget');
    this.title.icon = Correxit.Icons.correxit;
    this.identify();
    this.initialize();
  }

  get path(): string {
    return this.content.path;
  }
  set path(path: string) {
    if (!this.idle) return;
    this.content.start({
      path: PathExt.normalize(path),
      mode: 'scan',
      overwrite: false,
      submitted: false
    });
    this.busy = true;
    this.identify();
    this.selector?.reset();
    this.commands.notifyCommandChanged(Corrector.CommandIDs.cd);
  }

  get idle(): boolean {
    return !this.busy;
  }

  protected identify() {
    this.title.label = this.trans.__(
      'Corrector · %1',
      this.path === '.' ? '/' : PathExt.basename(this.path) || '/'
    );
    this.title.caption = this.path === '.' ? '/' : this.path;
  }

  dispose() {
    if (this.isDisposed) return;
    void this.commands.execute(CommandIDs.stop, {
      run: this.content.run,
      release: true
    });
    if (this.indicator && !this.indicator.isDisposed)
      this.indicator.set({ graded: true, scanned: true });
    super.dispose();
  }

  protected initialize() {
    const { commands, content, indicator, toolbar, trans } = this;
    const go = (
      mode: Corrector.Mode,
      overwrite: boolean,
      submitted: boolean
    ) => {
      this.busy = true;
      content.start({ mode, overwrite, submitted });
      commands.notifyCommandChanged(CommandIDs.cd);
      commands.notifyCommandChanged(CommandIDs.csv);
    };
    const stop = () => {
      content.set({ stopping: true });
      void commands.execute(CommandIDs.stop, { run: content.run });
    };
    const selector = new ModeSelector({ go, stop, trans });
    const notify = (updates: Corrector.Notification) => {
      this.busy = !(updates.graded && updates.scanned);
      indicator?.set(updates);
      selector?.set(updates);
      commands.notifyCommandChanged(CommandIDs.csv);
      commands.notifyCommandChanged(CommandIDs.cd);
    };
    const cd = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.cd,
      label: '',
      noFocusOnClick: true
    });
    const csv = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.csv,
      noFocusOnClick: true
    });
    this.selector = selector;
    toolbar.addItem('cd', cd);
    toolbar.addItem('csv', csv);
    toolbar.addItem('spacer', Toolbar.createSpacerItem());
    toolbar.addItem('mode', selector);
    content.set({ notify });
  }

  protected commands: CommandRegistry;
  protected indicator: CorrectorStatus | null;
  protected busy = true;
  protected selector: ModeSelector | null = null;
  protected trans: IRenderMime.TranslationBundle;
}

export namespace CorrectorWidget {
  export interface IOptions {
    commands: CommandRegistry;
    indicator: CorrectorStatus | null;
    path: string;
    trans: IRenderMime.TranslationBundle;
  }
}

class CorrectorContent extends ReactWidget {
  constructor(props: Pick<Corrector.Props, 'commands' | 'path' | 'trans'>) {
    super();
    this.props = {
      ...props,
      mode: 'scan',
      run: UUID.uuid4(),
      stopping: false,
      notify: () => {},
      overwrite: false,
      submitted: false
    };
    this.addClass('correxit-corrector-widget-content');
  }

  get path(): string {
    return this.props.path || '';
  }

  get run(): string {
    return this.props.run;
  }

  start(updates: Partial<Corrector.Props>) {
    void this.props.commands.execute(CommandIDs.stop, {
      run: this.run,
      release: true
    });
    this.set({ ...updates, run: UUID.uuid4(), stopping: false });
  }

  set(updates: Partial<Corrector.Props>) {
    this.props = { ...this.props, ...updates };
    this.update();
  }

  render() {
    const { trans } = this.props;
    const label = trans.__('Something went wrong rendering the corrector.');
    return (
      <Boundary label={label}>
        <Corrector {...this.props} />
      </Boundary>
    );
  }

  protected props: Corrector.Props;
}

export class CorrectorStatus extends ReactWidget {
  constructor(trans: IRenderMime.TranslationBundle) {
    super();
    this.trans = trans;
    this.addClass('correxit-corrector-status');
  }

  render() {
    const { graded, scanned, trans } = this;
    const label =
      this.message ||
      (!scanned
        ? trans.__('Scanning...')
        : !graded
          ? trans.__('Grading...')
          : trans.__('Idle'));
    return <span className="jp-StatusBar-TextItem">{label}</span>;
  }

  get idle(): boolean {
    return this.graded && this.scanned;
  }

  set(
    updates: Pick<Corrector.Notification, 'graded' | 'scanned'> &
      Partial<Pick<Corrector.Notification, 'message'>>
  ) {
    this.message = updates.message || '';
    this.graded = updates.graded;
    this.scanned = updates.scanned;
    this.update();
  }

  protected message = '';
  protected graded = true;
  protected scanned = true;
  protected trans: IRenderMime.TranslationBundle;
}

class ModeSelector extends ReactWidget {
  constructor(options: {
    go: (mode: Corrector.Mode, overwrite: boolean, submitted: boolean) => void;
    stop: () => void;
    trans: IRenderMime.TranslationBundle;
  }) {
    super();
    this.go = options.go;
    this.stop = options.stop;
    this.trans = options.trans;
    this.addClass('correxit-corrector-mode');
  }

  render() {
    const { busy, mode, stopping, submitted, trans } = this;
    const modes: { label: string; tooltip: string; value: Corrector.Mode }[] = [
      {
        value: 'scan',
        label: trans.__('Scan'),
        tooltip: trans.__('Find workbooks without grading them')
      },
      {
        value: 'grade',
        label: trans.__('Grade'),
        tooltip: trans.__('Find, authenticate, grade, and save workbooks')
      },
      {
        value: 'collect',
        label: trans.__('Sync'),
        tooltip: trans.__('Find and sync certified workbook grades')
      }
    ];
    const label = modes.find(item => item.value === mode)!.label;
    return (
      <>
        <fieldset
          className="correxit-corrector-mode-options"
          aria-label={trans.__('Corrector mode')}
          disabled={busy}
        >
          {modes.map(({ label, tooltip, value }) => (
            <label key={value} title={tooltip}>
              <input
                type="radio"
                name="correxit-mode"
                value={value}
                checked={mode === value}
                onChange={() => {
                  this.mode = value;
                  this.update();
                }}
                aria-label={label}
                aria-description={tooltip}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {mode !== 'collect' && (
          <label
            className="correxit-corrector-submitted"
            title={trans.__(
              'Only include workbooks with a local submission timestamp'
            )}
          >
            <input
              type="checkbox"
              checked={submitted}
              disabled={busy}
              onChange={({ target }) => {
                this.submitted = target.checked;
                this.update();
              }}
              aria-label={trans.__('Only include locally submitted workbooks')}
            />
            <span>{trans.__('Submitted only')}</span>
          </label>
        )}
        {mode !== 'scan' && (
          <label
            className="correxit-corrector-overwrite"
            title={
              mode === 'grade'
                ? trans.__(
                    'Re-execute workbooks instead of reusing authenticated grades'
                  )
                : trans.__(
                    'Sync again even when a collection receipt already exists'
                  )
            }
          >
            <input
              type="checkbox"
              checked={mode === 'grade' ? this.regrade : this.resync}
              disabled={busy}
              onChange={({ target }) => {
                if (mode === 'grade') this.regrade = target.checked;
                else this.resync = target.checked;
                this.update();
              }}
              aria-label={
                mode === 'grade' ? trans.__('Regrade') : trans.__('Resync')
              }
            />
            <span>
              {mode === 'grade' ? trans.__('Regrade') : trans.__('Resync')}
            </span>
          </label>
        )}
        <button
          className="correxit-corrector-mode-go"
          disabled={stopping}
          onClick={() => {
            if (busy) {
              this.stopping = true;
              this.stop();
            } else {
              this.busy = true;
              this.go(
                mode,
                mode === 'grade' ? this.regrade : this.resync,
                submitted
              );
            }
            this.update();
          }}
          aria-label={
            stopping ? trans.__('Stopping…') : busy ? trans.__('Stop') : label
          }
        >
          {stopping ? trans.__('Stopping…') : busy ? trans.__('Stop') : label}
        </button>
      </>
    );
  }

  reset() {
    this.mode = 'scan';
    this.busy = true;
    this.stopping = this.regrade = this.resync = this.submitted = false;
    this.update();
  }

  set({ graded, scanned }: Corrector.Notification) {
    this.busy = !(graded && scanned);
    if (!this.busy) this.stopping = false;
    this.update();
  }

  protected busy = true;
  protected stopping = false;
  protected go: (
    mode: Corrector.Mode,
    overwrite: boolean,
    submitted: boolean
  ) => void;
  protected stop: () => void;
  protected regrade = false;
  protected resync = false;
  protected mode: Corrector.Mode = 'scan';
  protected submitted = false;
  protected trans: IRenderMime.TranslationBundle;
}

export class ReviewerWidget extends MainAreaWidget<ReviewerContent> {
  constructor(options: ReviewerWidget.IOptions) {
    super({ content: new ReviewerContent(options) });
    this.addClass('correxit-reviewer-widget');
    this.initialize(options.commands, options.trans);
  }

  get workbook(): Workbook.Headless | null {
    return this.content.workbook;
  }

  navigate(cursor: { path: string; cell: string }) {
    this.content.set({ cursor });
  }

  move(direction: 'up' | 'down' | 'left' | 'right') {
    this.content.move(direction);
  }

  score(action: 'pass' | 'fail') {
    this.content.score(action);
  }

  dispose() {
    state.cursor(null);
    super.dispose();
  }

  protected initialize(
    commands: CommandRegistry,
    trans: IRenderMime.TranslationBundle
  ) {
    const { toolbar } = this;
    const button = (id: string) =>
      new CommandToolbarButton({ commands, id, noFocusOnClick: true });
    toolbar.addItem('left', button(CommandIDs.left));
    toolbar.addItem('up', button(CommandIDs.up));
    toolbar.addItem('down', button(CommandIDs.down));
    toolbar.addItem('right', button(CommandIDs.right));
    toolbar.addItem('info', new ReviewerInfoWidget(trans));
  }
}

export namespace ReviewerWidget {
  export interface IOptions {
    commands: CommandRegistry;
    factory: ((options: CodeEditor.IOptions) => CodeEditor.IEditor) | null;
    mimeTypeService: IEditorMimeTypeService | null;
    rendermime: IRenderMimeRegistry | null;
    trans: IRenderMime.TranslationBundle;
  }
}

class ReviewerInfoWidget extends ReactWidget {
  constructor(trans: IRenderMime.TranslationBundle) {
    super();
    this.trans = trans;
    this.addClass('correxit-reviewer-info');
  }

  render() {
    return <ReviewerInfo trans={this.trans} />;
  }

  protected trans: IRenderMime.TranslationBundle;
}

function ReviewerInfo({ trans }: { trans: IRenderMime.TranslationBundle }) {
  const { cursor, workbooks } = bridge.useSnapshot();
  if (!cursor) return null;

  const workbook = workbooks.find(
    (w): w is Exclude<Scanned, { hollow: true }> =>
      !w.hollow && w.context.path === cursor.path
  );
  if (!workbook) return null;

  const rubric = Workbook.open(workbook, true);
  if (!rubric) return null;

  const rows = workbook.context.model.sharedModel.cells
    .map(cell => cell.id)
    .filter(id => Rubric.has(rubric, id));
  const index = rows.indexOf(cursor.cell);
  if (index < 0) return null;

  const issue = rubric.assignment.issue.replace(/[^a-z0-9]/gi, '');
  const token = issue ? issue.slice(-6).toUpperCase() : `${index + 1}`;
  const score =
    Rubric.Score.resolve(rubric.assignment.report, cursor.cell) ?? null;

  return (
    <span>
      {trans.__('Review %1', token)}
      {' \u00b7 '}
      {trans.__('Cell %1 of %2', index + 1, rows.length)}
      {' \u00b7 '}
      <ScoreBadge
        report={rubric.assignment.report}
        cell={cursor.cell}
        score={score}
        trans={trans}
      />
    </span>
  );
}

function ScoreBadge(props: {
  report: Partial<Rubric.Assignment.Report>;
  cell: string;
  score: Rubric.Score | null;
  trans: IRenderMime.TranslationBundle;
}) {
  const { report, cell, score, trans } = props;
  if (!score || score.status === 'unscored') {
    const className =
      'correxit-reviewer-badge correxit-reviewer-badge-unscored';
    return <span className={className}> {trans.__('Unscored')}</span>;
  }

  const { interventions } = { ...Rubric.Assignment.Report.empty(), ...report };
  const manual = !!Rubric.Score.get(interventions, cell);
  const source = manual ? trans.__('Manual') : trans.__('Auto');
  const status = score.status;
  const className = [
    'correxit-reviewer-badge',
    `correxit-reviewer-badge-${status}`,
    manual && 'correxit-reviewer-badge-manual'
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={className} title={source}>
      {trans.__('%1/%2', score.points, score.possible)}
      <span className="correxit-reviewer-badge-label">{source}</span>
    </span>
  );
}

class ReviewerContent extends ReactWidget {
  constructor(
    props: Pick<
      Reviewer.Props,
      'commands' | 'factory' | 'mimeTypeService' | 'rendermime' | 'trans'
    >
  ) {
    super();
    this.props = {
      ...props,
      cursor: null,
      on: {
        navigate: ref => void (this.ref = ref),
        score: ref => void (this.scored = ref),
        workbook: workbook => void (this.workbook = workbook)
      }
    };
    this.ref = { current: () => {} };
    this.scored = { current: () => {} };
    this.addClass('correxit-reviewer-widget-content');
  }

  workbook: Workbook.Headless | null = null;

  move(direction: 'up' | 'down' | 'left' | 'right') {
    this.ref.current(direction);
  }

  render() {
    const { trans } = this.props;
    const label = trans.__('Something went wrong rendering the reviewer.');
    return (
      <Boundary label={label}>
        <Reviewer {...this.props} />
      </Boundary>
    );
  }

  score(action: 'pass' | 'fail') {
    this.scored.current(action);
  }

  set(updates: Partial<{ cursor: { path: string; cell: string } }>) {
    this.props = {
      ...this.props,
      cursor: updates.cursor ?? this.props.cursor
    };
    this.update();
  }

  protected props: Reviewer.Props;
  protected ref: Reviewer.Navigate;
  protected scored: React.MutableRefObject<(action: 'pass' | 'fail') => void>;
}
