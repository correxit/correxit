"use strict";
(self["rspackChunkcorrexit"] = self["rspackChunkcorrexit"] || []).push([["lib_index_js"], {
"./lib/corrector/bridge.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  clear: () => (clear),
  inject: () => (inject),
  navigate: () => (navigate),
  peek: () => (peek),
  publish: () => (publish),
  touch: () => (touch),
  useSnapshot: () => (useSnapshot)
});
/* import */ var react__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_0);

const empty = Object.freeze({
    cursor: null,
    grades: new Map(),
    revision: 0,
    workbooks: []
});
const listeners = new Set();
let snapshot = empty;
function clear() {
    snapshot = empty;
    emit();
}
function emit() {
    for (const listener of listeners)
        listener();
}
/**
 * Inject a workbook into the monitor stream.
 *
 * ### Notes
 * This invokes the `correxit:inject` command, which updates the monitor with
 * the given workbook, which notifies relevant commands, etc.
 */
function inject(commands, workbook) {
    void (async () => { var _a; return (_a = (await commands.execute('correxit:inject'))) === null || _a === void 0 ? void 0 : _a(workbook); })();
}
function navigate(cursor) {
    snapshot = { ...snapshot, cursor };
    emit();
}
function peek() {
    return snapshot;
}
function publish(next) {
    snapshot = { ...next, cursor: snapshot.cursor, revision: snapshot.revision };
    emit();
}
function touch() {
    snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    emit();
}
function useSnapshot() {
    return (0,react__rspack_import_0.useSyncExternalStore)(callback => {
        listeners.add(callback);
        return () => listeners.delete(callback);
    }, () => snapshot);
}


},
"./lib/corrector/commands.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  CommandIDs: () => (CommandIDs),
  commands: () => (commands)
});
/* import */ var _jupyterlab_apputils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/apputils");
/* import */ var _jupyterlab_apputils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__rspack_import_0);
/* import */ var _jupyterlab_coreutils__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_1);
/* import */ var _jupyterlab_filebrowser__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/filebrowser");
/* import */ var _jupyterlab_filebrowser__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_filebrowser__rspack_import_2);
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_12 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit_io__rspack_import_9 = __webpack_require__("./lib/correxit/io.js");
/* import */ var _correxit_kernels__rspack_import_5 = __webpack_require__("./lib/correxit/kernels.js");
/* import */ var ___rspack_import_10 = __webpack_require__("./lib/corrector/corrector.js");
/* import */ var ___rspack_import_11 = __webpack_require__("./lib/corrector/reviewer.js");
/* import */ var _bridge__rspack_import_7 = __webpack_require__("./lib/corrector/bridge.js");
/* import */ var _csv__rspack_import_8 = __webpack_require__("./lib/corrector/csv.js");
/* import */ var _grader__rspack_import_6 = __webpack_require__("./lib/corrector/grader.js");










var CommandIDs;
(function (CommandIDs) {
    CommandIDs.batch = 'correxit-corrector:batch';
    CommandIDs.cd = 'correxit-corrector:cd';
    CommandIDs.collect = 'correxit-corrector:collect';
    CommandIDs.csv = 'correxit-corrector:csv';
    CommandIDs.down = 'correxit-reviewer:down';
    CommandIDs.fail = 'correxit-reviewer:fail';
    CommandIDs.intervene = 'correxit-reviewer:intervene';
    CommandIDs.launch = 'correxit-corrector:launch';
    CommandIDs.left = 'correxit-reviewer:left';
    CommandIDs.pass = 'correxit-reviewer:pass';
    CommandIDs.review = 'correxit-reviewer:review';
    CommandIDs.right = 'correxit-reviewer:right';
    CommandIDs.run = 'correxit-reviewer:run';
    CommandIDs.scan = 'correxit-corrector:scan';
    CommandIDs.up = 'correxit-reviewer:up';
})(CommandIDs || (CommandIDs = {}));
function commands(app, utilities) {
    const { commands, serviceManager: manager, shell } = app;
    const { browser, collector, editors, indicator, rendermime, tracker, trans, tree, unlocker } = utilities;
    const { Error, Icons } = ___rspack_import_3.Correxit;
    const fetch = (handle, silent = false) => commands.execute(___rspack_import_3.Correxit.CommandIDs.fetch, { ...handle, silent });
    const { normalize } = ___rspack_import_4.Workbook.Credentials;
    const disposables = [];
    let corrector = null;
    let reviewer = null;
    disposables.push(commands.addCommand(CommandIDs.batch, {
        label: trans.__('Batch grade a scanned workbook directory...'),
        execute: (args) => {
            const auth = !!(args.key || args.passphrase);
            const overwrite = !!args.overwrite;
            const submitted = !!args.submitted;
            const potential = { ...args, unlock: auth ? !!args.unlock : true };
            const handle = normalize(potential);
            if (!handle)
                throw new Error.Invalid(`batch error, ${JSON.stringify(args)}`);
            const scan = normalize({ path: handle.path, unlock: false });
            if (!scan)
                throw new Error.Invalid(`batch error, ${JSON.stringify(args)}`);
            const actions = {
                correct: workbook => correct(workbook, handle, fetch, manager, trans),
                exclude: workbook => exclude(workbook, overwrite),
                recover
            };
            const cap = _correxit_kernels__rspack_import_5.cap();
            const retries = _correxit_kernels__rspack_import_5.retries();
            return (async function* () {
                const source = scanner({ commands }, { ...scan, submitted });
                const results = _grader__rspack_import_6.grade(source, actions, cap, retries);
                for await (const result of results) {
                    const { grade, workbook } = result.ok ? result.certified : result;
                    yield [grade.path, { grade, workbook: workbook }];
                }
            })();
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.cd, {
        icon: Icons.folder,
        caption: () => trans.__('Change directory - current: %1', corrector === null || corrector === void 0 ? void 0 : corrector.path),
        label: () => `/ ${corrector === null || corrector === void 0 ? void 0 : corrector.path.split('/').join(' / ')} /`,
        execute: async ({ path }) => {
            var _a;
            if (!corrector || corrector.isDisposed)
                return;
            corrector.addClass('cxt-mod-cd');
            if (typeof path !== 'string') {
                const title = trans.__('Correxit Corrector: change directory');
                const label = trans.__('Choose a directory for Correxit Corrector');
                const defaultPath = corrector.path;
                const host = corrector.node;
                const manager = (browser === null || browser === void 0 ? void 0 : browser.model.manager) || utilities.documents;
                const options = { defaultPath, host, label, manager, title };
                const pending = await _jupyterlab_filebrowser__rspack_import_2.FileDialog.getExistingDirectory(options);
                path = (_a = pending.value) === null || _a === void 0 ? void 0 : _a[0].path;
            }
            if (typeof path === 'string')
                corrector.path = path || '.';
            corrector.removeClass('cxt-mod-cd');
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.csv, {
        icon: Icons.csv,
        caption: trans.__('Export to CSV'),
        isEnabled: () => !!(indicator === null || indicator === void 0 ? void 0 : indicator.idle),
        execute: async () => {
            if (!corrector || corrector.isDisposed)
                return;
            const { contents } = manager;
            const { path } = corrector;
            const { workbooks, grades } = _bridge__rspack_import_7.peek();
            const content = _csv__rspack_import_8.generate(workbooks, grades);
            const target = await _correxit_io__rspack_import_9.available(manager, path, 'grades', '.csv');
            await contents.save(target, { type: 'file', format: 'text', content });
            void commands.execute('docmanager:open', { path: target });
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.collect, {
        label: trans.__('Collect certified workbook grades...'),
        execute: (args) => {
            const overwrite = !!args.overwrite;
            const auth = !!(args.key || args.passphrase);
            const credentials = { ...args, unlock: auth ? !!args.unlock : true };
            const handle = normalize(credentials);
            if (!handle)
                throw new Error.Invalid('collect error, bad handle');
            return (async function* () {
                var _a;
                for await (const workbook of scanner({ commands }, handle)) {
                    if (!(await authenticated(workbook, handle, unlocker)))
                        continue;
                    await ___rspack_import_4.Workbook.lock(workbook);
                    const certified = precertified(workbook);
                    if (!certified)
                        continue;
                    const { collected } = ((_a = open(workbook)) === null || _a === void 0 ? void 0 : _a.assignment) || {};
                    if (collected && !overwrite)
                        continue;
                    const receipt = await collector({ ...certified, workbook });
                    await ___rspack_import_4.Workbook.collect(workbook, receipt);
                    await save(workbook);
                    yield [certified.grade.path, { grade: certified.grade, workbook }];
                }
            })();
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.launch, {
        icon: Icons.correxit,
        label: trans.__('Launch Correxit Corrector'),
        execute: ({ path }) => {
            if (!corrector || corrector.isDisposed) {
                corrector = new ___rspack_import_10.Corrector.Widget({
                    commands,
                    path: path || (browser === null || browser === void 0 ? void 0 : browser.model.path) || '.',
                    indicator,
                    trans
                });
                corrector.id = 'correxit-corrector-widget';
                corrector.title.label = trans.__('Correxit Corrector');
                corrector.title.closable = true;
                disposables.push(corrector);
            }
            if (!tracker.corrector.has(corrector))
                tracker.corrector.add(corrector);
            if (tree) {
                if (!corrector.isAttached)
                    tree.addWidget(corrector);
                tree.currentWidget = corrector;
            }
            else if (!corrector.isAttached) {
                shell.add(corrector, 'main');
            }
            shell.activateById(corrector.id);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.scan, {
        label: trans.__('Scan a directory for Correxit workbooks'),
        execute: (handle) => (async function* scanner(handle, submitted) {
            var _a;
            const directory = handle && handle.path;
            if (!directory)
                return;
            let notebooks;
            try {
                notebooks = await _correxit_io__rspack_import_9.notebooks(manager, directory);
            }
            catch (error) {
                console.warn(CommandIDs.scan, directory, error);
                return;
            }
            if (!submitted) {
                for (const { path } of notebooks)
                    yield { hollow: true, context: { path } };
            }
            let prompted = false;
            for (const { path } of notebooks) {
                const fetched = await fetch({ ...handle, path }, prompted);
                if (fetched) {
                    const locked = (_a = open(fetched)) === null || _a === void 0 ? void 0 : _a.locked;
                    const unauthenticated = !handle.key && !handle.passphrase;
                    prompted || (prompted = !locked || !handle.unlock || !unauthenticated);
                    if (submitted && !submission(fetched)) {
                        fetched.context.dispose();
                        continue;
                    }
                    yield fetched;
                }
            }
        })(normalize({ ...handle, path: handle.path || '.' }), !!handle.submitted)
    }));
    disposables.push(commands.addCommand(CommandIDs.review, {
        label: trans.__('Launch Correxit Reviewer'),
        execute: (args) => {
            if (!reviewer || reviewer.isDisposed) {
                reviewer = new ___rspack_import_11.Reviewer.Widget({
                    commands,
                    factory: editors
                        ? options => editors.factoryService.newInlineEditor(options)
                        : null,
                    mimeTypeService: (editors === null || editors === void 0 ? void 0 : editors.mimeTypeService) || null,
                    rendermime,
                    trans
                });
                reviewer.id = 'correxit-reviewer-widget';
                reviewer.title.label = trans.__('Correxit Reviewer');
                reviewer.title.closable = true;
                disposables.push(reviewer);
            }
            if (!tracker.reviewer.has(reviewer))
                tracker.reviewer.add(reviewer);
            if (!reviewer.isAttached)
                shell.add(reviewer, 'main');
            shell.activateById(reviewer.id);
            if (args.path && args.cell)
                reviewer.navigate({ path: args.path, cell: args.cell });
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.intervene, {
        label: trans.__('Intervene on reviewer cell'),
        execute: async (args) => {
            var _a, _b;
            const workbook = (_a = reviewer === null || reviewer === void 0 ? void 0 : reviewer.workbook) !== null && _a !== void 0 ? _a : null;
            const { comment, id, intervention } = args;
            if (!workbook || !id)
                return;
            try {
                const rubric = open(workbook);
                if (!rubric)
                    return;
                if (rubric.locked)
                    await unlocker.unlock(workbook, null);
                if (intervention !== undefined)
                    await ___rspack_import_4.Workbook.intervene(workbook, id, intervention !== null && intervention !== void 0 ? intervention : null);
                if (comment !== undefined)
                    await ___rspack_import_4.Workbook.comment(workbook, id, comment);
                await save(workbook);
                // Auto-certify if this was the last pending reviewable cell.
                const updated = open(workbook);
                const { certification } = (_b = updated === null || updated === void 0 ? void 0 : updated.assignment) !== null && _b !== void 0 ? _b : {};
                if (updated && !updated.locked && !certification) {
                    if (!___rspack_import_12.Rubric.pending(updated)) {
                        try {
                            await ___rspack_import_4.Workbook.certify(workbook, trans, true);
                            await save(workbook);
                        }
                        catch (_c) {
                            // Certification may fail if auto-graded cells are unresolved;
                            // the workbook will be certified on the next batch pass.
                        }
                    }
                }
                _bridge__rspack_import_7.touch();
            }
            catch (error) {
                void (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.run, {
        caption: trans.__('Run reviewer cell'),
        label: trans.__('Run'),
        execute: async (args) => {
            var _a, _b, _c, _d, _e;
            const workbook = (_a = reviewer === null || reviewer === void 0 ? void 0 : reviewer.workbook) !== null && _a !== void 0 ? _a : null;
            const id = (_d = (_b = args.id) !== null && _b !== void 0 ? _b : (_c = _bridge__rspack_import_7.peek().cursor) === null || _c === void 0 ? void 0 : _c.cell) !== null && _d !== void 0 ? _d : null;
            if (!workbook || !id)
                return null;
            try {
                const rubric = open(workbook);
                if (!rubric)
                    return null;
                const result = await ___rspack_import_4.Workbook.execute(workbook, rubric, id);
                if (!result)
                    throw new globalThis.Error('run error: execute failed');
                return (_e = result.outputs.get(id)) !== null && _e !== void 0 ? _e : [];
            }
            catch (error) {
                void (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
                return null;
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.up, {
        caption: trans.__('Previous cell'),
        label: '↑',
        execute: () => reviewer === null || reviewer === void 0 ? void 0 : reviewer.move('up')
    }));
    disposables.push(commands.addCommand(CommandIDs.down, {
        caption: trans.__('Next cell'),
        label: '↓',
        execute: () => reviewer === null || reviewer === void 0 ? void 0 : reviewer.move('down')
    }));
    disposables.push(commands.addCommand(CommandIDs.left, {
        caption: trans.__('Previous workbook'),
        label: '←',
        execute: () => reviewer === null || reviewer === void 0 ? void 0 : reviewer.move('left')
    }));
    disposables.push(commands.addCommand(CommandIDs.right, {
        caption: trans.__('Next workbook'),
        label: '→',
        execute: () => reviewer === null || reviewer === void 0 ? void 0 : reviewer.move('right')
    }));
    disposables.push(commands.addCommand(CommandIDs.pass, {
        caption: trans.__('Pass cell'),
        label: trans.__('Pass'),
        execute: () => reviewer === null || reviewer === void 0 ? void 0 : reviewer.score('pass')
    }));
    disposables.push(commands.addCommand(CommandIDs.fail, {
        caption: trans.__('Fail cell'),
        label: trans.__('Fail'),
        execute: () => reviewer === null || reviewer === void 0 ? void 0 : reviewer.score('fail')
    }));
    return disposables;
}
async function authenticated(workbook, handle, unlocker) {
    const { path } = workbook.context;
    try {
        const credentials = { ...handle, path, silent: true };
        return !!(await unlocker.unlock(workbook, credentials));
    }
    catch (_a) {
        return false;
    }
}
async function correct(workbook, handle, fetch, manager, trans) {
    var _a, _b;
    const { path } = workbook.context;
    const dir = _jupyterlab_coreutils__rspack_import_1.PathExt.dirname(path) || '.';
    const notebook = workbook.context.model.toJSON();
    const resources = (_b = (_a = open(workbook)) === null || _a === void 0 ? void 0 : _a.assignment.resources) !== null && _b !== void 0 ? _b : null;
    const capacity = _correxit_kernels__rspack_import_5.cap();
    const local = await _correxit_io__rspack_import_9.stage({ capacity, dir, manager, notebook, resources });
    const staged = (await fetch({
        ...handle,
        path: local.path
    }));
    if (!staged) {
        await local.release();
        throw new ___rspack_import_3.Correxit.Error.Certify('correct error: staging failed');
    }
    try {
        const certified = await grade(staged, trans);
        const snapshot = staged.context.model.toJSON();
        const restored = ___rspack_import_4.Workbook.restore(workbook, snapshot);
        if (!restored)
            throw new ___rspack_import_3.Correxit.Error.Certify('correct error: restore failed');
        await workbook.context.save();
        const identifier = ___rspack_import_4.Workbook.identifier(workbook);
        if (!___rspack_import_4.Workbook.Identifier.assigned(identifier))
            throw new ___rspack_import_3.Correxit.Error.Certify('correct error: unassigned');
        return {
            ...certified,
            grade: { ...certified.grade, path },
            identifier,
            workbook
        };
    }
    finally {
        staged.context.dispose();
        await local.release();
    }
}
function exclude(workbook, overwrite) {
    const rubric = open(workbook);
    if (!rubric || overwrite)
        return null;
    const path = workbook.context.path;
    const { assignment } = rubric;
    const { report } = assignment;
    if (___rspack_import_12.Rubric.Assignment.rejected(assignment))
        return null;
    const summary = ___rspack_import_12.Rubric.Assignment.summary(report, assignment);
    const identifier = ___rspack_import_4.Workbook.identifier(workbook);
    if (!___rspack_import_4.Workbook.Identifier.assigned(identifier))
        return null;
    const grade = (spec) => ({
        grade: { path, resolved: true, score: summary, spec },
        identifier,
        workbook
    });
    if (assignment.certification)
        return grade(report.kernel);
    const { scores } = report;
    const ids = Object.keys(rubric.cells);
    const scored = ids.length > 0 && ids.every(id => scores[id] && !unexecuted(scores[id]));
    if (!scored)
        return null;
    return ___rspack_import_12.Rubric.pending(rubric) ? grade(report.kernel) : null;
}
async function grade(workbook, trans) {
    const rubric = open(workbook);
    if (!rubric || rubric.locked)
        throw new ___rspack_import_3.Correxit.Error.Certify('grade error: invalid rubric');
    if (___rspack_import_12.Rubric.Assignment.rejected(rubric.assignment))
        throw new ___rspack_import_3.Correxit.Error.Certify('grade error: overdue rejected');
    if (!___rspack_import_12.Rubric.pending(rubric)) {
        const certified = await ___rspack_import_4.Workbook.certify(workbook, trans);
        await save(workbook);
        return certified;
    }
    const grade = await ___rspack_import_4.Workbook.correct(workbook);
    const identifier = ___rspack_import_4.Workbook.identifier(workbook);
    if (!___rspack_import_4.Workbook.Identifier.assigned(identifier))
        throw new ___rspack_import_3.Correxit.Error.Certify('grade error: unassigned');
    await ___rspack_import_4.Workbook.lock(workbook);
    await save(workbook);
    return { grade, identifier, workbook };
}
function open(workbook) {
    return ___rspack_import_4.Workbook.open(workbook, true);
}
function precertified(workbook) {
    const rubric = open(workbook);
    if (!rubric || !rubric.locked)
        return null;
    const { assignment, cells } = rubric;
    const { kernel, scores } = assignment.report;
    if (___rspack_import_12.Rubric.Assignment.rejected(assignment))
        return null;
    const path = workbook.context.path;
    const incomplete = Object.keys(cells).some(id => !scores[id]);
    const partial = Object.values(scores).some(unexecuted);
    const uncertified = !assignment.certification;
    const summary = ___rspack_import_12.Rubric.Assignment.summary(assignment.report, assignment);
    const unscored = summary.status === 'unscored';
    if (incomplete ||
        partial ||
        ___rspack_import_12.Rubric.pending(rubric) ||
        uncertified ||
        unscored)
        return null;
    const grade = { path, resolved: true, score: summary, spec: kernel };
    const identifier = ___rspack_import_4.Workbook.identifier(workbook);
    if (!___rspack_import_4.Workbook.Identifier.assigned(identifier))
        return null;
    return { grade, identifier, workbook };
}
function recover(workbook) {
    const grade = {
        path: workbook.context.path,
        resolved: false,
        score: { ...___rspack_import_12.Rubric.Score.UNSCORED },
        spec: null
    };
    return { ok: false, grade, workbook };
}
async function save(workbook) {
    await (workbook === null || workbook === void 0 ? void 0 : workbook.context.save());
}
async function* scanner({ commands }, credentials) {
    const stream = await commands.execute(CommandIDs.scan, credentials);
    for await (const workbook of stream)
        if (!workbook.hollow)
            yield workbook;
}
function submission(workbook) {
    var _a;
    return ((_a = open(workbook)) === null || _a === void 0 ? void 0 : _a.assignment.submission) !== null;
}
function unexecuted({ code }) {
    return code === 'missing-given' || code === 'missing-reference';
}


},
"./lib/corrector/corrector.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Corrector: () => (Corrector)
});
/* import */ var _jupyterlab_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_0);
/* import */ var _jupyterlab_ui_components__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_1);
/* import */ var _lumino_algorithm__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@lumino/algorithm");
/* import */ var _lumino_algorithm__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_lumino_algorithm__rspack_import_2);
/* import */ var react__rspack_import_3 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_3_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_3);
/* import */ var ___rspack_import_6 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_9 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_12 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _correxit_state__rspack_import_5 = __webpack_require__("./lib/correxit/state.js");
/* import */ var _correxit_use_command__rspack_import_10 = __webpack_require__("./lib/correxit/use-command.js");
/* import */ var _ui_trail__rspack_import_8 = __webpack_require__("./lib/ui/trail.js");
/* import */ var _bridge__rspack_import_7 = __webpack_require__("./lib/corrector/bridge.js");
/* import */ var _commands__rspack_import_4 = __webpack_require__("./lib/corrector/commands.js");
/* import */ var _widget__rspack_import_11 = __webpack_require__("./lib/corrector/widget.js");











const FAILED = 'cxt-mod-failed';
const PENDING = 'cxt-mod-pending';
const SELECTED = 'cxt-mod-selected';
const { batch, collect, scan } = _commands__rspack_import_4.CommandIDs;
const { basename } = _jupyterlab_coreutils__rspack_import_0.PathExt;
/**
 * Cache workbook contexts by path.
 */
const cache = (cached, workbooks) => {
    for (const workbook of workbooks) {
        const path = workbook.context.path;
        const kept = cached[path];
        if (kept && kept !== workbook)
            kept.context.dispose();
        cached[path] = workbook;
    }
};
/**
 * Dispose workbook contexts.
 */
const dispose = (workbooks) => workbooks.forEach(({ context }) => context.dispose());
const release = (cached) => {
    dispose(Object.values(cached));
    const workbook = _correxit_state__rspack_import_5.workbook();
    if (___rspack_import_6.Workbook.headless(workbook))
        _correxit_state__rspack_import_5.workbook(null);
    _bridge__rspack_import_7.clear();
};
const advance = (workbooks, path, step) => {
    const order = workbooks.map(({ context }) => context.path);
    const index = order.indexOf(path);
    if (index === -1)
        return null;
    return order[index + step] || null;
};
const retreat = (event) => {
    if (event.key !== 'Escape')
        return;
    event.preventDefault();
    event.stopPropagation();
    const row = event.currentTarget.closest('tr');
    if (row instanceof HTMLTableRowElement)
        row.focus();
};
const keydown = (path, walk) => (event) => {
    if (event.target !== event.currentTarget)
        return;
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        walk.move(path, -1);
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        walk.move(path, 1);
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        walk.clear();
        return;
    }
    if (event.key !== 'Enter' && event.key !== ' ')
        return;
    event.preventDefault();
    walk.select(path);
};
const useWalk = (workbooks) => {
    const nodes = (0,react__rspack_import_3.useRef)({});
    const pending = (0,react__rspack_import_3.useRef)('');
    const [focused, setFocused] = (0,react__rspack_import_3.useState)('');
    const [selected, setSelected] = (0,react__rspack_import_3.useState)('');
    const active = (0,react__rspack_import_3.useMemo)(() => {
        var _a;
        if (workbooks.some(({ context }) => context.path === focused))
            return focused;
        if (workbooks.some(({ context }) => context.path === selected))
            return selected;
        return ((_a = workbooks[0]) === null || _a === void 0 ? void 0 : _a.context.path) || '';
    }, [focused, selected, workbooks]);
    const select = (0,react__rspack_import_3.useCallback)((path) => {
        setFocused(path);
        setSelected(path);
    }, []);
    const clear = (0,react__rspack_import_3.useCallback)(() => setSelected(''), []);
    const move = (0,react__rspack_import_3.useCallback)((path, step) => {
        const next = advance(workbooks, path, step);
        if (!next)
            return;
        pending.current = next;
        select(next);
    }, [select, workbooks]);
    const node = (0,react__rspack_import_3.useCallback)((path, row) => {
        nodes.current[path] = row;
    }, []);
    (0,react__rspack_import_3.useEffect)(() => {
        if (!focused)
            return;
        if (workbooks.some(({ context }) => context.path === focused))
            return;
        setFocused('');
    }, [focused, workbooks]);
    (0,react__rspack_import_3.useEffect)(() => {
        if (!selected)
            return;
        if (workbooks.some(({ context }) => context.path === selected))
            return;
        setSelected('');
    }, [selected, workbooks]);
    (0,react__rspack_import_3.useEffect)(() => {
        const row = nodes.current[pending.current];
        if (!row)
            return;
        row.focus();
        pending.current = '';
    }, [selected, workbooks]);
    return { active, clear, move, node, select, selected };
};
/** @returns a multi-line lifecycle history for tooltips. */
const history = (workbook, trans) => {
    const rubric = open(workbook);
    return rubric ? (0,_ui_trail__rspack_import_8.trail)(rubric.assignment, trans).join('\n') : '';
};
/** @returns the lifecycle phase of a workbook. */
const lifecycle = (workbook, grade) => {
    if (grade === 'pending')
        return 'pending';
    if (!grade.resolved)
        return 'failed';
    if (workbook.hollow)
        return 'scanned';
    const rubric = open(workbook);
    if (!rubric)
        return 'scanned';
    const { assignment } = rubric;
    if (assignment.collected)
        return 'collected';
    if (assignment.certification)
        return 'certified';
    return ___rspack_import_9.Rubric.pending(rubric) ? 'review' : 'scanned';
};
/** @returns the logo of a kernel in order of preference. */
const logo = (spec) => {
    const { resources } = spec;
    const src = resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
    return src || '';
};
/** @returns a workbook or `null` if path matches workbook context. */
const match = (workbooks, path = '') => ((0,_lumino_algorithm__rspack_import_2.find)(workbooks, workbook => {
    return workbook.context.path === path && !workbook.hollow;
}) || null);
/** @returns a merged list workbooks that prioritizes the graded collection. */
const merge = (scanned, grades) => {
    const latest = new Map();
    for (const workbook of scanned)
        latest.set(workbook.context.path, workbook);
    for (const [path, file] of grades)
        latest.set(path, file.workbook);
    return Array.from(latest.values());
};
/** Open a workbook rubric quietly. */
const open = (workbook) => workbook && !workbook.hollow ? ___rspack_import_6.Workbook.open(workbook, true) : null;
/** Collect workbook paths as a set. */
const paths = (workbooks) => new Set(workbooks.map(({ context }) => context.path));
/** Dispose and remove cached workbooks not in the live path set. */
const prune = (cached, live, active) => {
    for (const [path, workbook] of Object.entries(cached)) {
        if (live.has(path) || path === active)
            continue;
        workbook.context.dispose();
        delete cached[path];
    }
};
/** Reconcile cached workbooks with the current merged list. */
const reconcile = (cached, workbooks, focus) => {
    prune(cached, paths(workbooks), focus);
    cache(cached, workbooks.filter(reified));
};
/** A filter function that filters out hollow workbooks. */
const reified = (workbook) => !workbook.hollow;
/** @returns the number of resolved grades in a collation of workbooks. */
const resolutions = (collated) => Array.from(collated.values()).filter(({ grade }) => grade.resolved).length;
/** @returns the grade for a workbook given current batch and scan state. */
const resolve = (workbook, collated, graded) => {
    var _a;
    const { path } = workbook.context;
    if (collated.has(path))
        return collated.get(path).grade;
    if (workbook.hollow || !graded)
        return 'pending';
    const rubric = open(workbook);
    const report = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.report;
    const summary = report && rubric
        ? ___rspack_import_9.Rubric.Assignment.summary(report, rubric.assignment)
        : null;
    const score = summary || ___rspack_import_9.Rubric.Score.UNSCORED;
    return { path, resolved: true, score, spec: (_a = report === null || report === void 0 ? void 0 : report.kernel) !== null && _a !== void 0 ? _a : null };
};
/** @returns the at-a-glance status of a workbook in the corrector. */
const status = (grade, graded, phase, trans) => {
    if (phase === 'failed')
        return graded ? trans.__('failed') : trans.__('retrying');
    const { points, possible, status } = grade.score;
    const unscored = status === 'unscored';
    if (phase === 'collected') {
        return unscored
            ? trans.__('unscored \u00b7 collected')
            : trans.__('%1 of %2 \u00b7 collected', points, possible);
    }
    if (phase === 'certified') {
        return unscored
            ? trans.__('unscored \u00b7 certified')
            : trans.__('%1 of %2 \u00b7 certified', points, possible);
    }
    if (phase === 'review') {
        return unscored
            ? trans.__('unscored \u00b7 review')
            : trans.__('%1 of %2 \u00b7 review', points, possible);
    }
    return unscored
        ? trans.__('unscored')
        : trans.__('%1 of %2', points, possible);
};
function Corrector(props) {
    const { commands, mode, notify, overwrite, path, submitted, trans } = props;
    const grading = mode !== 'scan';
    const cwd = { path, submitted };
    const [files, scanned] = (0,_correxit_use_command__rspack_import_10.useCommand)(commands, scan, cwd);
    const command = mode === 'grade' ? batch : mode === 'collect' ? collect : '';
    const auth = mode === 'grade';
    const config = { ...cwd, overwrite, ...(auth ? { unlock: true } : {}) };
    const [batched, graded] = (0,_correxit_use_command__rspack_import_10.useCommand)(commands, command, config);
    const loaded = (0,react__rspack_import_3.useMemo)(() => files.filter(reified).length, [files]);
    const grades = (0,react__rspack_import_3.useMemo)(() => new Map(batched), [batched]);
    const resolved = (0,react__rspack_import_3.useMemo)(() => resolutions(grades), [grades]);
    const workbooks = (0,react__rspack_import_3.useMemo)(() => merge(files, grades), [files, grades]);
    const cached = (0,react__rspack_import_3.useRef)({});
    const walk = useWalk(workbooks);
    const workbook = (0,react__rspack_import_3.useMemo)(() => match(workbooks, walk.selected), [walk.selected, workbooks]);
    const focus = (workbook === null || workbook === void 0 ? void 0 : workbook.context.path) || null;
    const total = workbooks.length;
    const progress = { graded, grading, loaded, resolved, scanned, total };
    (0,react__rspack_import_3.useEffect)(() => () => release(cached.current), []);
    (0,react__rspack_import_3.useEffect)(() => _bridge__rspack_import_7.inject(commands, workbook), [commands, workbook]);
    (0,react__rspack_import_3.useEffect)(() => notify({ graded, scanned, mode }), [graded, mode, notify, scanned]);
    (0,react__rspack_import_3.useEffect)(() => reconcile(cached.current, workbooks, focus), [focus, workbooks]);
    (0,react__rspack_import_3.useEffect)(() => _bridge__rspack_import_7.publish({ workbooks, grades }), [grades, workbooks]);
    return (react__rspack_import_3_default().createElement("table", { "aria-label": trans.__('Corrector workbooks'), className: "correxit-corrector" },
        react__rspack_import_3_default().createElement(Columns, null),
        react__rspack_import_3_default().createElement("tbody", null,
            react__rspack_import_3_default().createElement(Progress, { ...{ ...progress, trans } }),
            workbooks.map(workbook => {
                const grade = resolve(workbook, grades, graded);
                const { path } = workbook.context;
                const props = { commands, grade, graded, trans, walk, workbook };
                return react__rspack_import_3_default().createElement(Row, { ...props, key: path });
            }))));
}
(function (Corrector) {
    Corrector.commands = _commands__rspack_import_4.commands;
    Corrector.CommandIDs = _commands__rspack_import_4.CommandIDs;
    Corrector.Modes = ['scan', 'grade', 'collect'];
    Corrector.Status = _widget__rspack_import_11.CorrectorStatus;
    Corrector.Widget = _widget__rspack_import_11.CorrectorWidget;
})(Corrector || (Corrector = {}));
const Progress = ({ graded, grading, loaded, resolved, scanned, total, trans }) => {
    const active = !!total && (!scanned || (grading && !graded));
    const peak = (0,react__rspack_import_3.useRef)(0);
    peak.current = Math.max(peak.current, grading ? resolved : loaded);
    const progress = active ? peak.current : 0;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;
    const className = active
        ? 'correxit-corrector-progress cxt-mod-active'
        : 'correxit-corrector-progress';
    return (react__rspack_import_3_default().createElement("tr", { className: className },
        react__rspack_import_3_default().createElement("td", { colSpan: 5 }, active ? (react__rspack_import_3_default().createElement("div", { className: "correxit-corrector-progress-bar" },
            react__rspack_import_3_default().createElement("progress", { "aria-label": trans.__('Corrector progress'), max: total, value: progress }),
            react__rspack_import_3_default().createElement("span", null, trans.__('%1%', percent)))) : null)));
};
const Columns = () => (react__rspack_import_3_default().createElement("colgroup", null,
    react__rspack_import_3_default().createElement("col", { className: "correxit-corrector-col-open" }),
    react__rspack_import_3_default().createElement("col", { className: "correxit-corrector-col-assignee" }),
    react__rspack_import_3_default().createElement("col", { className: "correxit-corrector-col-breakdown" }),
    react__rspack_import_3_default().createElement("col", { className: "correxit-corrector-col-kernel" }),
    react__rspack_import_3_default().createElement("col", { className: "correxit-corrector-col-status" })));
const Line = ({ children, className, path, walk }) => {
    const active = path === walk.active;
    const selected = path === walk.selected;
    return (react__rspack_import_3_default().createElement("tr", { "aria-selected": selected, className: className, "data-path": path, onClick: event => {
            walk.select(path);
            event.currentTarget.focus();
        }, onFocus: () => walk.select(path), onKeyDown: keydown(path, walk), ref: row => walk.node(path, row), tabIndex: active ? 0 : -1 }, children));
};
const HollowRow = ({ className, path, walk }) => (react__rspack_import_3_default().createElement(Line, { ...{ className, path, walk } },
    react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-open" }),
    react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-assignee" }, basename(path)),
    react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-breakdown" }),
    react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-kernel" }),
    react__rspack_import_3_default().createElement(Pending, null)));
const Row = react__rspack_import_3_default().memo(props => {
    const { commands, grade, graded, trans, walk, workbook } = props;
    const { path } = workbook.context;
    const active = path === walk.active;
    const selected = path === walk.selected;
    const pending = grade === 'pending';
    const failed = !pending && !grade.resolved;
    const phase = lifecycle(workbook, grade);
    const className = [failed && FAILED, pending && PENDING, selected && SELECTED]
        .filter(Boolean)
        .join(' ');
    if (workbook.hollow)
        return react__rspack_import_3_default().createElement(HollowRow, { ...{ className, path, walk } });
    const spec = pending ? null : grade.spec;
    const title = history(workbook, trans);
    return (react__rspack_import_3_default().createElement(Line, { ...{ className, path, walk } },
        react__rspack_import_3_default().createElement(Notebook, { ...{ active, commands, trans, workbook } }),
        react__rspack_import_3_default().createElement(Assignee, { ...{ workbook } }),
        react__rspack_import_3_default().createElement(Breakdown, { ...{ active, commands, failed, trans, workbook } }),
        react__rspack_import_3_default().createElement(Kernel, { ...{ spec } }),
        react__rspack_import_3_default().createElement(Status, { ...{ grade, graded, phase, title, trans } })));
});
const Breakdown = ({ active, commands, failed, trans, workbook }) => {
    if (failed)
        return react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-breakdown" });
    const rubric = open(workbook);
    if (!rubric)
        return react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-breakdown" });
    const { cells } = rubric;
    const { report } = rubric.assignment;
    const breakdown = workbook.context.model.sharedModel.cells
        .map(cell => cell.id)
        .filter(id => id in cells);
    const computed = (id) => { var _a; return (_a = ___rspack_import_9.Rubric.Score.resolve(report, id)) !== null && _a !== void 0 ? _a : ___rspack_import_9.Rubric.Score.UNSCORED; };
    const status = (id) => {
        const { status } = computed(id);
        const reviewable = cells[id].is === 'reviewable';
        return reviewable && status === 'unscored' ? 'review' : status;
    };
    const label = (id) => {
        const resolution = status(id);
        const { points, possible } = computed(id);
        const { is: type } = cells[id];
        if (resolution === 'review')
            return trans.__('%1: needs review', type);
        if (resolution === 'unscored')
            return trans.__('%1: unscored', type);
        return trans.__('%1: %2 of %3', type, points, possible);
    };
    const { review } = _commands__rspack_import_4.CommandIDs;
    return (react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-breakdown" },
        react__rspack_import_3_default().createElement("div", { "aria-label": trans.__('Workbook cell breakdown'), className: "correxit-corrector-breakdown-bar", role: "group" }, breakdown.map(id => {
            const className = [
                'correxit-corrector-breakdown-segment',
                `correxit-corrector-breakdown-${status(id)}`
            ].join(' ');
            return (react__rspack_import_3_default().createElement("button", { "aria-label": trans.__('Review %1', label(id)), className: className, key: id, onKeyDown: retreat, onClick: event => {
                    event.stopPropagation();
                    void commands.execute(review, {
                        path: workbook.context.path,
                        cell: id
                    });
                }, tabIndex: active ? 0 : -1, title: label(id), type: "button" }));
        }))));
};
const Assignee = ({ workbook }) => {
    const path = basename(workbook.context.path);
    const rubric = open(workbook);
    return (react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-assignee" }, (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.assignee) || path));
};
const Notebook = ({ active, commands, trans, workbook }) => {
    const open = 'docmanager:open';
    const file = { path: workbook.context.path };
    const caption = trans.__('Open workbook');
    return (react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-open", onClick: event => event.stopPropagation(), onKeyDown: retreat },
        react__rspack_import_3_default().createElement("div", { className: "correxit-corrector-icon" },
            react__rspack_import_3_default().createElement(_jupyterlab_ui_components__rspack_import_1.Button, { "aria-label": caption, className: "jp-ToolbarButtonComponent", "data-command": open, minimal: true, onClick: () => void commands.execute(open, file), tabIndex: active ? 0 : -1, title: caption, type: "button" },
                react__rspack_import_3_default().createElement(_jupyterlab_ui_components__rspack_import_1.notebookIcon.react, { tag: null })))));
};
const Status = ({ grade, graded, phase, title, trans }) => {
    if (phase === 'pending' || grade === 'pending')
        return react__rspack_import_3_default().createElement(Pending, null);
    return (react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-status" },
        react__rspack_import_3_default().createElement("span", { "aria-label": title || undefined, className: `correxit-corrector-chip cxt-mod-${phase}`, role: title ? 'status' : undefined, title: title || undefined }, status(grade, graded, phase, trans))));
};
const Pending = () => (react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-status" },
    react__rspack_import_3_default().createElement("span", { className: 'correxit-corrector-chip cxt-mod-pending' },
        react__rspack_import_3_default().createElement("span", { className: "correxit-corrector-pending-dot" }),
        react__rspack_import_3_default().createElement("span", { className: "correxit-corrector-pending-dot" }),
        react__rspack_import_3_default().createElement("span", { className: "correxit-corrector-pending-dot" }))));
const Kernel = ({ spec }) => {
    if (!spec)
        return react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-kernel" });
    const src = logo(spec);
    return (react__rspack_import_3_default().createElement("td", { className: "correxit-corrector-kernel" },
        react__rspack_import_3_default().createElement("div", { className: "correxit-corrector-icon" }, src ? (react__rspack_import_3_default().createElement("img", { src: src, title: spec.display_name, alt: spec.name })) : (react__rspack_import_3_default().createElement(___rspack_import_12.Correxit.Icons.kernel.react, { tag: "span", title: spec.name })))));
};


},
"./lib/corrector/csv.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  generate: () => (generate)
});
/* import */ var ___rspack_import_0 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");

function generate(workbooks, grades) {
    const { summary } = ___rspack_import_0.Rubric.Assignment;
    const identity = ['assignee', 'assignment', 'expiration', 'title', 'rubric'];
    const resolution = ['issue', 'points', 'possible'];
    const lifecycle = [
        'distribution',
        'submission',
        'submitted',
        'certification',
        'collected'
    ];
    const diagnostic = ['resolved', 'path'];
    const header = [...identity, ...resolution, ...lifecycle, ...diagnostic];
    const reified = workbooks.filter(workbook => !workbook.hollow);
    const rows = reified.map(workbook => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const rubric = ___rspack_import_1.Workbook.open(workbook, true);
        const path = workbook.context.path;
        const grade = (_b = (_a = grades.get(path)) === null || _a === void 0 ? void 0 : _a.grade) !== null && _b !== void 0 ? _b : null;
        const assignee = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.assignee) || '';
        const assignment = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.id) || '';
        const title = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.name) || '';
        const issue = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.issue) || '';
        const total = rubric
            ? summary(rubric.assignment.report, rubric.assignment)
            : null;
        const { points, possible, status } = (_d = (_c = grade === null || grade === void 0 ? void 0 : grade.score) !== null && _c !== void 0 ? _c : total) !== null && _d !== void 0 ? _d : ___rspack_import_0.Rubric.Score.UNSCORED;
        const expiration = (_e = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.expiration) !== null && _e !== void 0 ? _e : null;
        const distribution = (_f = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.distribution) !== null && _f !== void 0 ? _f : null;
        const submission = (_g = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.submission) !== null && _g !== void 0 ? _g : null;
        const submitted = (_h = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.submitted) !== null && _h !== void 0 ? _h : null;
        const certification = (_j = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.certification) !== null && _j !== void 0 ? _j : null;
        const collected = (_k = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.collected) !== null && _k !== void 0 ? _k : null;
        const resolved = (_l = grade === null || grade === void 0 ? void 0 : grade.resolved) !== null && _l !== void 0 ? _l : false;
        const unscored = status === 'unscored';
        return [
            assignee,
            assignment,
            ___rspack_import_0.Rubric.timestamp(expiration),
            title,
            (rubric === null || rubric === void 0 ? void 0 : rubric.id) || '',
            issue,
            unscored ? '' : String(points),
            unscored ? '' : String(possible),
            ___rspack_import_0.Rubric.timestamp(distribution),
            ___rspack_import_0.Rubric.timestamp(submission),
            submitted !== null && submitted !== void 0 ? submitted : '',
            ___rspack_import_0.Rubric.timestamp(certification),
            collected !== null && collected !== void 0 ? collected : '',
            String(resolved),
            path
        ];
    });
    const body = [header, ...rows]
        .map(row => row.map(escape).join(','))
        .join('\r\n');
    return '\uFEFF' + body;
}
function escape(field) {
    const safe = /^[=+\-@\t\r]/.test(field) ? `'${field}` : field;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}


},
"./lib/corrector/grader.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  grade: () => (grade)
});
/**
 * Grade scanned workbooks with bounded in-flight concurrency.
 *
 * @param scanner - Cold async iterable of headless workbooks to grade.
 * @param actions - Functions orchestrated by the grader.
 *   - `correct`: async grading function.
 *   - `exclude`: synchronous fast path that returns a certified result when the
 *     workbook should be emitted immediately without grading.
 *   - `recover`: fallback result for failures after retries.
 * @param cap - Maximum number of workbooks being graded simultaneously.
 *   Values less than 1 are clamped to 1.
 * @param retries - How many times to retry a workbook where `correct` throws
 *   before giving up and calling `recover`. Workbooks that return
 *   `resolved: false` are not retried. Defaults to `0`.
 *
 * #### Notes
 * `grade()` consumes `scanner` lazily: the next workbook is only fetched once a
 * concurrency slot is free, so the kernel pool never grows faster than grading
 * can drain it.
 *
 * Timeouts are not managed here, the kernel lease deadline (`kernels.timeout`)
 * is the authoritative timeout because it starts after `acquire()` resolves,
 * not while waiting for a pool slot.
 *
 * Graded workbooks are yielded in completion order (fastest first).
 * Failures are recovered and yielded so a bad workbook cannot stall the batch.
 */
async function* grade(scanner, actions, cap, retries = 0) {
    let next = null;
    let inflight = 0;
    const max = Math.max(1, cap);
    const queue = [];
    const attempts = new WeakMap();
    const sleep = () => new Promise(resolve => void (next = resolve));
    const wake = () => {
        next === null || next === void 0 ? void 0 : next();
        next = null;
    };
    const start = (workbook) => {
        const { correct } = actions;
        inflight++;
        correct(workbook)
            .then(value => queue.push({ status: 'fulfilled', value }))
            .catch(reason => queue.push({ status: 'rejected', reason, workbook }))
            .finally(() => {
            inflight--;
            wake();
        });
    };
    const take = async () => {
        while (!queue.length) {
            if (!inflight)
                return null;
            await sleep();
        }
        return queue.shift();
    };
    const emit = async () => {
        var _a;
        const settled = await take();
        if (!settled)
            return null;
        if (settled.status === 'fulfilled')
            return { ok: true, certified: settled.value };
        const tried = ((_a = attempts.get(settled.workbook)) !== null && _a !== void 0 ? _a : 0) + 1;
        if (tried <= retries) {
            attempts.set(settled.workbook, tried);
            start(settled.workbook);
            return null;
        }
        attempts.delete(settled.workbook);
        console.warn('grader error', settled.workbook.context.path, settled.reason);
        return actions.recover(settled.workbook);
    };
    for await (const workbook of scanner) {
        const cached = actions.exclude(workbook);
        if (cached) {
            yield { ok: true, certified: cached };
            continue;
        }
        while (inflight >= max) {
            const result = await emit();
            if (result)
                yield result;
        }
        start(workbook);
        while (queue.length) {
            const result = await emit();
            if (result)
                yield result;
        }
    }
    while (inflight || queue.length) {
        const result = await emit();
        if (result)
            yield result;
    }
}


},
"./lib/corrector/reviewer.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Reviewer: () => (Reviewer)
});
/* import */ var _jupyterlab_codeeditor__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/codeeditor");
/* import */ var _jupyterlab_codeeditor__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_codeeditor__rspack_import_0);
/* import */ var _jupyterlab_nbformat__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/nbformat");
/* import */ var _jupyterlab_nbformat__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_nbformat__rspack_import_1);
/* import */ var _jupyterlab_services__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/services");
/* import */ var _jupyterlab_services__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_services__rspack_import_2);
/* import */ var react__rspack_import_3 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_3_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_3);
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_7 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit_state__rspack_import_6 = __webpack_require__("./lib/correxit/state.js");
/* import */ var _bridge__rspack_import_5 = __webpack_require__("./lib/corrector/bridge.js");
/* import */ var _commands__rspack_import_8 = __webpack_require__("./lib/corrector/commands.js");
/* import */ var _widget__rspack_import_9 = __webpack_require__("./lib/corrector/widget.js");









const open = (workbook) => workbook && !workbook.hollow ? ___rspack_import_4.Workbook.open(workbook, true) : null;
const reified = (workbook) => !workbook.hollow;
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const code = (cell) => !!cell && cell.cell_type === 'code';
const language = (workbook) => {
    if (!workbook)
        return null;
    const notebook = workbook.context.model.sharedModel;
    const info = notebook.getMetadata('language_info');
    if (record(info))
        return info;
    const spec = notebook.getMetadata('kernelspec');
    const name = record(spec) && typeof spec.language === 'string' ? spec.language : null;
    return name ? { name } : null;
};
const mime = (workbook, mimeTypeService) => {
    const info = language(workbook);
    if (typeof (info === null || info === void 0 ? void 0 : info.mimetype) === 'string' && info.mimetype)
        return info.mimetype;
    if (!mimeTypeService)
        return _jupyterlab_codeeditor__rspack_import_0.IEditorMimeTypeService.defaultMimeType;
    return info
        ? mimeTypeService.getMimeTypeByLanguage(info)
        : _jupyterlab_codeeditor__rspack_import_0.IEditorMimeTypeService.defaultMimeType;
};
const integer = (value) => {
    if (value === '')
        return '';
    const parsed = Number(value);
    if (Number.isNaN(parsed))
        return '';
    return Math.max(0, Math.floor(parsed));
};
const instructions = (workbook, cursor, rubric) => {
    if (!workbook || !cursor || !rubric)
        return null;
    const cells = workbook.context.model.sharedModel.cells;
    const index = cells.findIndex(cell => cell.id === cursor.cell);
    if (index <= 0)
        return null;
    const span = 3;
    const block = [];
    for (let i = index - 1; i >= 0 && block.length < span; i--) {
        const preceding = cells[i];
        if (preceding.cell_type !== 'markdown')
            break;
        if (preceding.id in rubric.cells)
            break;
        if (preceding.id in rubric.references)
            break;
        const source = preceding.getSource();
        if (!source.trim())
            break;
        block.unshift(source);
    }
    return block.length ? block.join('\n\n') : null;
};
function Reviewer(props) {
    var _a, _b, _c, _d, _e;
    const { commands, factory, mimeTypeService, rendermime, trans, cursor: initial } = props;
    const snapshot = _bridge__rspack_import_5.useSnapshot();
    const { workbooks, grades, revision } = snapshot;
    const empty = workbooks.length === 0;
    const [cursor, setCursor] = (0,react__rspack_import_3.useState)(initial !== null && initial !== void 0 ? initial : null);
    (0,react__rspack_import_3.useEffect)(() => {
        if (initial)
            setCursor(initial);
    }, [initial]);
    const columns = (0,react__rspack_import_3.useMemo)(() => workbooks.filter(reified).map(w => w.context.path), [workbooks]);
    const path = cursor === null || cursor === void 0 ? void 0 : cursor.path;
    const workbook = (0,react__rspack_import_3.useMemo)(() => {
        var _a;
        return path === undefined
            ? null
            : ((_a = workbooks
                .filter(reified)
                .find(({ context }) => context.path === path)) !== null && _a !== void 0 ? _a : null);
    }, [path, workbooks]);
    const rubric = (0,react__rspack_import_3.useMemo)(() => {
        // Manual interventions update the workbook cache in place.
        void revision;
        return open(workbook);
    }, [revision, workbook]);
    const certified = !!(rubric && rubric.assignment.certification);
    const rows = (0,react__rspack_import_3.useMemo)(() => {
        if (!workbook || !rubric)
            return [];
        return workbook.context.model.sharedModel.cells
            .map(cell => cell.id)
            .filter(id => id in rubric.cells);
    }, [workbook, rubric]);
    (0,react__rspack_import_3.useEffect)(() => {
        props.on.workbook(workbook);
        if (workbook)
            void _bridge__rspack_import_5.inject(commands, workbook);
        if (cursor)
            _correxit_state__rspack_import_6.cursor(cursor.cell);
        _bridge__rspack_import_5.navigate(cursor);
        return () => void _correxit_state__rspack_import_6.cursor(null);
    }, [commands, cursor, props.on, workbook]);
    // Navigation helpers.
    const navigate = (0,react__rspack_import_3.useCallback)((direction) => {
        if (!cursor)
            return;
        const col = columns.indexOf(cursor.path);
        const row = rows.indexOf(cursor.cell);
        if (col < 0 || row < 0)
            return;
        const next = { col, row };
        switch (direction) {
            case 'up':
                if (row > 0) {
                    next.row = row - 1;
                }
                else if (col > 0) {
                    next.col = col - 1;
                    next.row = rows.length - 1;
                }
                break;
            case 'down':
                if (row < rows.length - 1) {
                    next.row = row + 1;
                }
                else if (col < columns.length - 1) {
                    next.col = col + 1;
                    next.row = 0;
                }
                break;
            case 'left':
                if (col > 0) {
                    next.col = col - 1;
                }
                else if (row > 0) {
                    next.row = row - 1;
                    next.col = columns.length - 1;
                }
                break;
            case 'right':
                if (col < columns.length - 1) {
                    next.col = col + 1;
                }
                else if (row < rows.length - 1) {
                    next.row = row + 1;
                    next.col = 0;
                }
                break;
        }
        setCursor({
            path: columns[next.col],
            cell: rows[next.row]
        });
    }, [cursor, columns, rows]);
    const ref = (0,react__rspack_import_3.useRef)(navigate);
    ref.current = navigate;
    (0,react__rspack_import_3.useEffect)(() => props.on.navigate(ref), [props.on]);
    const cell = rubric && cursor ? rubric.cells[cursor.cell] : null;
    const id = cursor === null || cursor === void 0 ? void 0 : cursor.cell;
    const model = (0,react__rspack_import_3.useMemo)(() => {
        var _a;
        if (!workbook || !id)
            return null;
        const cells = workbook.context.model.sharedModel.cells;
        return (_a = cells.find(cell => cell.id === id)) !== null && _a !== void 0 ? _a : null;
    }, [id, workbook]);
    const type = (_a = model === null || model === void 0 ? void 0 : model.cell_type) !== null && _a !== void 0 ? _a : 'code';
    const source = (_b = model === null || model === void 0 ? void 0 : model.getSource()) !== null && _b !== void 0 ? _b : '';
    const mimetype = (0,react__rspack_import_3.useMemo)(() => mime(workbook, mimeTypeService), [workbook, mimeTypeService]);
    const question = (0,react__rspack_import_3.useMemo)(() => instructions(workbook, cursor, rubric), [cursor, rubric, workbook]);
    const stored = code(model) ? model.outputs : [];
    const [corrected, setCorrected] = (0,react__rspack_import_3.useState)(null);
    (0,react__rspack_import_3.useEffect)(() => void setCorrected(null), [cursor]);
    const outputs = corrected !== null && corrected !== void 0 ? corrected : stored;
    const report = rubric
        ? ((_d = ___rspack_import_7.Rubric.Score.resolve(rubric.assignment.report, (_c = cursor === null || cursor === void 0 ? void 0 : cursor.cell) !== null && _c !== void 0 ? _c : '')) !== null && _d !== void 0 ? _d : null)
        : null;
    const persisted = report && report.status !== 'unscored' ? report.points : '';
    const possible = cell ? cell.points : 0;
    const [score, setScore] = (0,react__rspack_import_3.useState)(persisted);
    const [comment, setComment] = (0,react__rspack_import_3.useState)((_e = report === null || report === void 0 ? void 0 : report.comment) !== null && _e !== void 0 ? _e : '');
    (0,react__rspack_import_3.useEffect)(() => {
        var _a, _b;
        void revision;
        const resolved = rubric && cursor
            ? ((_a = ___rspack_import_7.Rubric.Score.resolve(rubric.assignment.report, cursor.cell)) !== null && _a !== void 0 ? _a : null)
            : null;
        setScore(resolved && resolved.status !== 'unscored' ? resolved.points : '');
        setComment((_b = resolved === null || resolved === void 0 ? void 0 : resolved.comment) !== null && _b !== void 0 ? _b : '');
    }, [cursor, revision, rubric]);
    const commit = (0,react__rspack_import_3.useCallback)(async (points) => {
        if (!cursor || !cell || !workbook || certified)
            return;
        const intervention = ___rspack_import_7.Rubric.Score.intervene(cursor.cell, {
            comment,
            points,
            possible: cell.points
        });
        await commands.execute(_commands__rspack_import_8.CommandIDs.intervene, {
            id: cursor.cell,
            intervention,
            ...(comment ? { comment } : {})
        });
    }, [cell, certified, commands, comment, cursor, workbook]);
    const scoring = (0,react__rspack_import_3.useRef)('idle');
    const [busy, setBusy] = (0,react__rspack_import_3.useState)(false);
    const save = (0,react__rspack_import_3.useCallback)(async (write) => {
        if (scoring.current === 'saving')
            return;
        scoring.current = 'saving';
        setBusy(true);
        try {
            await write();
        }
        finally {
            scoring.current = 'idle';
            setBusy(false);
        }
    }, []);
    const directional = (0,react__rspack_import_3.useCallback)(async (points, direction) => {
        await save(async () => {
            await commit(points);
            navigate(direction);
        });
    }, [commit, navigate, save]);
    const fail = (direction) => void directional(0, direction);
    const pass = (direction) => {
        const value = typeof score === 'number' && score !== possible ? score : possible;
        void directional(value, direction);
    };
    const judge = (0,react__rspack_import_3.useCallback)(async (action) => {
        if (certified)
            return;
        await save(async () => {
            const points = action === 'fail'
                ? 0
                : typeof score === 'number' && score !== possible
                    ? score
                    : possible;
            await commit(points);
        });
    }, [certified, commit, possible, save, score]);
    const scored = (0,react__rspack_import_3.useRef)(judge);
    scored.current = judge;
    (0,react__rspack_import_3.useEffect)(() => props.on.score(scored), [props.on]);
    const rerun = async () => {
        if (!cursor || !workbook || type !== 'code' || busy)
            return;
        setBusy(true);
        setCorrected([]);
        try {
            const args = { id: cursor.cell };
            const result = await commands.execute(_commands__rspack_import_8.CommandIDs.run, args);
            if (result !== null)
                setCorrected(result);
        }
        finally {
            setBusy(false);
        }
    };
    const partial = typeof score === 'number' && score !== possible && score !== persisted;
    if (empty) {
        return (react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer correxit-reviewer-idle" },
            react__rspack_import_3_default().createElement("p", null, trans.__('Open the Corrector to begin reviewing.'))));
    }
    if (!cursor || !workbook || !rubric) {
        return (react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer correxit-reviewer-idle" },
            react__rspack_import_3_default().createElement("p", null, trans.__('Select a cell to begin reviewing.'))));
    }
    return (react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer" },
        react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer-body" },
            react__rspack_import_3_default().createElement(Minimap, { columns: columns, cursor: cursor, grades: grades, revision: revision, rows: rows, setCursor: setCursor, trans: trans, workbooks: workbooks }),
            react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer-content" },
                question && (react__rspack_import_3_default().createElement(CellSource, { factory: null, label: trans.__('Question context'), mimetype: mimetype, placeholder: "", rendermime: rendermime, source: question, type: "markdown", muted: true })),
                react__rspack_import_3_default().createElement(CellSource, { factory: factory, label: trans.__('Current cell'), mimetype: mimetype, placeholder: trans.__('(blank)'), rendermime: rendermime, source: source, type: type }),
                type === 'code' && outputs.length > 0 && (react__rspack_import_3_default().createElement("div", { "aria-label": trans.__('Cell outputs'), className: "correxit-reviewer-outputs" }, outputs.map((output, i) => (react__rspack_import_3_default().createElement(CellOutput, { key: i, output: output, rendermime: rendermime }))))),
                certified ? (react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer-certified" },
                    react__rspack_import_3_default().createElement("p", null, trans.__('Certified (read-only)')))) : (react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer-scoring" },
                    react__rspack_import_3_default().createElement("textarea", { "aria-label": trans.__('Reviewer comment'), className: "correxit-reviewer-comment", "data-lm-suppress-shortcuts": "true", onChange: ({ target: { value } }) => setComment(value), placeholder: trans.__('Comment...'), rows: 3, value: comment }),
                    react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer-scoring-grid" },
                        react__rspack_import_3_default().createElement("button", { className: "correxit-reviewer-btn correxit-reviewer-btn-fail", disabled: busy, onClick: () => fail('down'), title: trans.__('Fail and advance to next cell') },
                            react__rspack_import_3_default().createElement("span", null, trans.__('Fail')),
                            " ",
                            react__rspack_import_3_default().createElement("span", null, "\u2193")),
                        react__rspack_import_3_default().createElement("span", { className: "correxit-reviewer-score-display" },
                            react__rspack_import_3_default().createElement("input", { "aria-label": trans.__('Score'), className: "correxit-reviewer-score-input", "data-lm-suppress-shortcuts": "true", inputMode: "numeric", min: "0", onChange: ({ target: { value } }) => setScore(integer(value)), step: "1", type: "number", value: score }),
                            react__rspack_import_3_default().createElement("span", { className: "correxit-reviewer-score-sep" }, "/"),
                            react__rspack_import_3_default().createElement("span", { className: "correxit-reviewer-score-possible" }, possible)),
                        react__rspack_import_3_default().createElement("button", { className: [
                                'correxit-reviewer-btn correxit-reviewer-btn-pass',
                                partial && 'cxt-mod-partial'
                            ]
                                .filter(Boolean)
                                .join(' '), disabled: busy, onClick: () => pass('down'), title: trans.__('Pass and advance to next cell') },
                            react__rspack_import_3_default().createElement("span", null, partial ? trans.__('Partial') : trans.__('Pass')),
                            ' ',
                            react__rspack_import_3_default().createElement("span", null, "\u2193")),
                        react__rspack_import_3_default().createElement("button", { className: "correxit-reviewer-btn correxit-reviewer-btn-fail", disabled: busy, onClick: () => fail('right'), title: trans.__('Fail and advance to next workbook') },
                            react__rspack_import_3_default().createElement("span", null, trans.__('Fail')),
                            " ",
                            react__rspack_import_3_default().createElement("span", null, "\u2192")),
                        react__rspack_import_3_default().createElement("span", null),
                        react__rspack_import_3_default().createElement("button", { className: [
                                'correxit-reviewer-btn correxit-reviewer-btn-pass',
                                partial && 'cxt-mod-partial'
                            ]
                                .filter(Boolean)
                                .join(' '), disabled: busy, onClick: () => pass('right'), title: trans.__('Pass and advance to next workbook') },
                            react__rspack_import_3_default().createElement("span", null, partial ? trans.__('Partial') : trans.__('Pass')),
                            ' ',
                            react__rspack_import_3_default().createElement("span", null, "\u2192"))),
                    type === 'code' && (react__rspack_import_3_default().createElement("button", { className: "correxit-reviewer-btn correxit-reviewer-btn-run", disabled: busy, onClick: rerun, title: trans.__('Run cell for output preview') }, busy ? trans.__('Running…') : trans.__('Run')))))))));
}
(function (Reviewer) {
    Reviewer.commands = _commands__rspack_import_8.commands;
    Reviewer.Widget = _widget__rspack_import_9.ReviewerWidget;
})(Reviewer || (Reviewer = {}));
const CellSource = ({ factory, label, mimetype, muted, placeholder, rendermime, source, type }) => {
    const host = (0,react__rspack_import_3.useRef)(null);
    const editor = (0,react__rspack_import_3.useRef)(null);
    const mime = type === 'code' ? mimetype : undefined;
    const className = [
        'correxit-reviewer-source',
        `cxt-cell-${type}`,
        muted && 'cxt-mod-question'
    ]
        .filter(Boolean)
        .join(' ');
    // Code cells: use a read-only CodeMirror editor for syntax highlighting.
    (0,react__rspack_import_3.useEffect)(() => {
        if (type !== 'code' || !factory || !host.current)
            return;
        host.current.textContent = '';
        const model = new _jupyterlab_codeeditor__rspack_import_0.CodeEditor.Model({ mimeType: mimetype });
        model.sharedModel.setSource(source);
        const cached = factory({
            host: host.current,
            model,
            config: { readOnly: true, lineNumbers: false }
        });
        editor.current = cached;
        return () => {
            editor.current = null;
            cached.dispose();
            model.dispose();
        };
    }, [factory, mimetype, source, type]);
    // Markdown cells: use rendermime for rich rendering.
    (0,react__rspack_import_3.useEffect)(() => {
        if (type !== 'markdown' || !rendermime || !host.current)
            return;
        host.current.textContent = '';
        const renderer = rendermime.createRenderer('text/markdown');
        const model = rendermime.createModel({
            data: { 'text/markdown': source },
            trusted: false
        });
        void renderer.renderModel(model).then(() => {
            if (host.current) {
                host.current.textContent = '';
                host.current.appendChild(renderer.node);
            }
        });
        return () => renderer.dispose();
    }, [source, type, rendermime]);
    const empty = placeholder;
    const unavailable = (type === 'code' && !factory) ||
        (type === 'markdown' && !rendermime) ||
        type === 'raw';
    if (unavailable) {
        return (react__rspack_import_3_default().createElement("div", { "aria-label": label, className: className, "data-mimetype": mime, key: "plain" },
            react__rspack_import_3_default().createElement("pre", null, source || (react__rspack_import_3_default().createElement("span", { className: "correxit-reviewer-source-blank" }, empty)))));
    }
    if (!source) {
        return (react__rspack_import_3_default().createElement("div", { "aria-label": label, className: className, "data-mimetype": mime, key: "blank" },
            react__rspack_import_3_default().createElement("pre", null,
                react__rspack_import_3_default().createElement("span", { className: "correxit-reviewer-source-blank" }, empty))));
    }
    return (react__rspack_import_3_default().createElement("div", { "aria-label": label, className: className, "data-mimetype": mime, key: "rich", ref: host }));
};
const kernel = (output) => 'header' in output && 'content' in output;
const text = (value) => {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(text).join('');
    return JSON.stringify(value);
};
const bundle = (output) => {
    if (kernel(output)) {
        if (_jupyterlab_services__rspack_import_2.KernelMessage.isDisplayDataMsg(output) ||
            _jupyterlab_services__rspack_import_2.KernelMessage.isExecuteResultMsg(output))
            return output.content.data;
        if (_jupyterlab_services__rspack_import_2.KernelMessage.isStreamMsg(output))
            return { 'text/plain': text(output.content.text) };
        if (!_jupyterlab_services__rspack_import_2.KernelMessage.isErrorMsg(output))
            return {};
        const { ename, evalue, traceback } = output.content;
        const error = traceback.length
            ? traceback.join('\n')
            : `${ename}: ${evalue}`;
        return { 'text/plain': error };
    }
    if ((0,_jupyterlab_nbformat__rspack_import_1.isDisplayData)(output) || (0,_jupyterlab_nbformat__rspack_import_1.isExecuteResult)(output))
        return output.data;
    if ((0,_jupyterlab_nbformat__rspack_import_1.isStream)(output))
        return { 'text/plain': text(output.text) };
    if (!(0,_jupyterlab_nbformat__rspack_import_1.isError)(output))
        return {};
    const error = output.traceback.length
        ? output.traceback.join('\n')
        : `${output.ename}: ${output.evalue}`;
    return { 'text/plain': error };
};
const plain = (mime, output) => {
    const value = mime['text/plain'];
    return value === undefined ? JSON.stringify(output) : text(value);
};
const CellOutput = ({ output, rendermime }) => {
    const host = (0,react__rspack_import_3.useRef)(null);
    const mime = (0,react__rspack_import_3.useMemo)(() => bundle(output), [output]);
    const mimetype = (0,react__rspack_import_3.useMemo)(() => { var _a; return (_a = rendermime === null || rendermime === void 0 ? void 0 : rendermime.preferredMimeType(mime, 'prefer')) !== null && _a !== void 0 ? _a : null; }, [mime, rendermime]);
    const fallback = (0,react__rspack_import_3.useMemo)(() => plain(mime, output), [mime, output]);
    (0,react__rspack_import_3.useEffect)(() => {
        if (!rendermime || !mimetype || !host.current)
            return;
        host.current.textContent = '';
        const renderer = rendermime.createRenderer(mimetype);
        const model = rendermime.createModel({ data: mime, trusted: false });
        void renderer.renderModel(model).then(() => {
            if (host.current) {
                host.current.textContent = '';
                host.current.appendChild(renderer.node);
            }
        });
        return () => renderer.dispose();
    }, [mime, mimetype, rendermime]);
    if (!rendermime || !mimetype)
        return react__rspack_import_3_default().createElement("pre", { className: "correxit-reviewer-output" }, fallback);
    return react__rspack_import_3_default().createElement("div", { className: "correxit-reviewer-output", ref: host });
};
const Minimap = ({ columns, cursor, grades, revision, rows, setCursor, trans, workbooks }) => {
    const host = (0,react__rspack_import_3.useRef)(null);
    const focus = (0,react__rspack_import_3.useRef)(null);
    const grid = (0,react__rspack_import_3.useMemo)(() => {
        // These signals invalidate rubric values cached behind stable workbooks.
        void grades;
        void revision;
        const rubrics = new Map(workbooks
            .filter(reified)
            .map(workbook => [workbook.context.path, open(workbook)]));
        return rows.map(id => columns.map(path => {
            var _a;
            const rubric = (_a = rubrics.get(path)) !== null && _a !== void 0 ? _a : null;
            if (!rubric)
                return 'unscored';
            const cell = rubric.cells[id];
            if (!cell)
                return 'unscored';
            const score = ___rspack_import_7.Rubric.Score.resolve(rubric.assignment.report, id);
            const reviewable = cell.is === 'reviewable';
            if (!score || score.status === 'unscored')
                return reviewable ? 'review' : 'unscored';
            return score.status;
        }));
    }, [columns, rows, workbooks, grades, revision]);
    (0,react__rspack_import_3.useEffect)(() => {
        var _a;
        const current = focus.current;
        if (!current)
            return;
        current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if ((_a = host.current) === null || _a === void 0 ? void 0 : _a.contains(document.activeElement))
            current.focus();
    }, [cursor.cell, cursor.path]);
    const keyed = (row, col) => ({
        cell: rows[row],
        path: columns[col]
    });
    const identity = (row, col) => `correxit-reviewer-minimap-${col}-${row}`;
    const active = {
        column: columns.indexOf(cursor.path),
        row: rows.indexOf(cursor.cell),
        id: undefined
    };
    active.id =
        active.row < 0 || active.column < 0
            ? undefined
            : identity(active.row, active.column);
    const label = (row, col, status, active) => active
        ? trans.__('%1, cell %2, %3, active', columns[col], row + 1, status)
        : trans.__('%1, cell %2, %3', columns[col], row + 1, status);
    return (react__rspack_import_3_default().createElement("div", { "aria-activedescendant": active.id, className: "correxit-reviewer-minimap", ref: host, role: "grid", "aria-label": trans.__('Score minimap'), style: {
            gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))`
        } }, grid.map((line, row) => line.map((status, col) => {
        const active = cursor.cell === rows[row] && cursor.path === columns[col];
        const className = [
            'correxit-reviewer-minimap-cell',
            `correxit-reviewer-minimap-${status}`,
            active && 'cxt-mod-active'
        ]
            .filter(Boolean)
            .join(' ');
        const target = keyed(row, col);
        return (react__rspack_import_3_default().createElement("button", { "aria-label": label(row, col, status, active), "aria-selected": active, className: className, id: identity(row, col), key: `${row}-${col}`, onClick: () => setCursor(target), ref: active ? focus : undefined, role: "gridcell", tabIndex: active ? 0 : -1, title: label(row, col, status, active), type: "button" }));
    }))));
};


},
"./lib/corrector/widget.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  CorrectorStatus: () => (CorrectorStatus),
  CorrectorWidget: () => (CorrectorWidget),
  ReviewerWidget: () => (ReviewerWidget)
});
/* import */ var _jupyterlab_apputils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/apputils");
/* import */ var _jupyterlab_apputils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__rspack_import_0);
/* import */ var _jupyterlab_coreutils__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_1);
/* import */ var _jupyterlab_ui_components__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_2);
/* import */ var react__rspack_import_3 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_3_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_3);
/* import */ var _correxit__rspack_import_9 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _correxit__rspack_import_10 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit_state__rspack_import_7 = __webpack_require__("./lib/correxit/state.js");
/* import */ var _ui__rspack_import_6 = __webpack_require__("./lib/ui/boundary.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/corrector/corrector.js");
/* import */ var _bridge__rspack_import_8 = __webpack_require__("./lib/corrector/bridge.js");
/* import */ var _commands__rspack_import_5 = __webpack_require__("./lib/corrector/commands.js");
/* import */ var _reviewer__rspack_import_11 = __webpack_require__("./lib/corrector/reviewer.js");











class CorrectorWidget extends _jupyterlab_apputils__rspack_import_0.MainAreaWidget {
    constructor({ commands, indicator, path, trans }) {
        super({ content: new CorrectorContent({ commands, path, trans }) });
        this.initialized = false;
        this.selector = null;
        this.commands = commands;
        this.indicator = indicator;
        this.trans = trans;
        this.addClass('correxit-corrector-widget');
    }
    get path() {
        return this.content.path;
    }
    set path(path) {
        var _a;
        this.content.set({ path: _jupyterlab_coreutils__rspack_import_1.PathExt.normalize(path) });
        (_a = this.selector) === null || _a === void 0 ? void 0 : _a.reset();
        this.commands.notifyCommandChanged(___rspack_import_4.Corrector.CommandIDs.cd);
    }
    dispose() {
        if (this.isDisposed)
            return;
        if (this.indicator && !this.indicator.isDisposed)
            this.indicator.set({ graded: true, scanned: true });
        super.dispose();
    }
    async initialize() {
        const { commands, content, indicator, toolbar, trans } = this;
        const go = (mode, overwrite, submitted) => content.set({ key: `${Date.now()}`, mode, overwrite, submitted });
        const selector = new ModeSelector({ go, trans });
        const notify = (updates) => {
            indicator === null || indicator === void 0 ? void 0 : indicator.set(updates);
            selector === null || selector === void 0 ? void 0 : selector.set(updates);
            commands.notifyCommandChanged(_commands__rspack_import_5.CommandIDs.csv);
        };
        const cd = new _jupyterlab_ui_components__rspack_import_2.CommandToolbarButton({
            commands,
            id: ___rspack_import_4.Corrector.CommandIDs.cd,
            noFocusOnClick: true
        });
        const csv = new _jupyterlab_ui_components__rspack_import_2.CommandToolbarButton({
            commands,
            id: ___rspack_import_4.Corrector.CommandIDs.csv,
            noFocusOnClick: true
        });
        this.selector = selector;
        toolbar.addItem('cd', cd);
        toolbar.addItem('csv', csv);
        toolbar.addItem('spacer', _jupyterlab_ui_components__rspack_import_2.Toolbar.createSpacerItem());
        toolbar.addItem('mode', selector);
        content.set({ notify });
    }
    onBeforeShow(msg) {
        if (!this.initialized) {
            this.initialized = true;
            void this.initialize().catch(_ => { });
        }
        super.onBeforeShow(msg);
    }
}
class CorrectorContent extends _jupyterlab_ui_components__rspack_import_2.ReactWidget {
    constructor(props) {
        super();
        this.props = {
            ...props,
            mode: 'scan',
            notify: () => { },
            overwrite: false,
            submitted: false
        };
        this.addClass('correxit-corrector-widget-content');
    }
    get path() {
        return this.props.path || '';
    }
    set(updates) {
        if (updates.path !== undefined)
            updates = { ...updates, mode: 'scan', key: `${Date.now()}` };
        this.props = { ...this.props, ...updates };
        this.update();
    }
    render() {
        const { trans } = this.props;
        const label = trans.__('Something went wrong rendering the corrector.');
        return (react__rspack_import_3_default().createElement(_ui__rspack_import_6.Boundary, { label: label },
            react__rspack_import_3_default().createElement(___rspack_import_4.Corrector, { ...this.props })));
    }
}
class CorrectorStatus extends _jupyterlab_ui_components__rspack_import_2.ReactWidget {
    constructor(trans) {
        super();
        this.graded = true;
        this.scanned = true;
        this.trans = trans;
        this.addClass('correxit-corrector-status');
    }
    render() {
        const { graded, scanned, trans } = this;
        const label = !scanned
            ? trans.__('Scanning...')
            : !graded
                ? trans.__('Grading...')
                : trans.__('Idle');
        return react__rspack_import_3_default().createElement("span", { className: "jp-StatusBar-TextItem" }, label);
    }
    get idle() {
        return this.graded && this.scanned;
    }
    set(updates) {
        this.graded = updates.graded;
        this.scanned = updates.scanned;
        this.update();
    }
}
class ModeSelector extends _jupyterlab_ui_components__rspack_import_2.ReactWidget {
    constructor(options) {
        super();
        this.busy = false;
        this.overwrite = false;
        this.mode = 'scan';
        this.submitted = false;
        this.go = options.go;
        this.trans = options.trans;
        this.addClass('correxit-corrector-mode');
    }
    handleEvent(event) {
        event.stopPropagation();
    }
    onBeforeAttach(msg) {
        super.onBeforeAttach(msg);
        this.node.addEventListener('click', this);
        this.node.removeEventListener('pointerdown', this);
    }
    onAfterDetach(msg) {
        super.onAfterDetach(msg);
        this.node.removeEventListener('click', this);
        this.node.removeEventListener('pointerdown', this);
    }
    render() {
        const { busy, mode, overwrite, submitted, trans } = this;
        const modes = [
            {
                value: 'scan',
                label: trans.__('Scan'),
                tooltip: trans.__('Scan for workbooks, leave them locked')
            },
            {
                value: 'grade',
                label: trans.__('Grade'),
                tooltip: trans.__('Unlock, grade, certify, and save workbooks')
            },
            {
                value: 'collect',
                label: trans.__('Collect'),
                tooltip: trans.__('Collect certified workbook grades')
            }
        ];
        const action = () => this.go(mode, overwrite, submitted);
        const label = busy ? trans.__('Interrupt') : trans.__('Go');
        const className = `correxit-corrector-mode-go ${busy ? 'jp-mod-warn' : 'jp-mod-accept'}`;
        const description = busy
            ? trans.__('Interrupt the current operation')
            : trans.__('Execute selected mode');
        return (react__rspack_import_3_default().createElement((react__rspack_import_3_default().Fragment), null,
            react__rspack_import_3_default().createElement("fieldset", { className: "correxit-corrector-mode-options", "aria-label": trans.__('Corrector mode'), style: { border: 0, padding: 0, margin: 0 } }, modes.map(({ label, tooltip, value }) => (react__rspack_import_3_default().createElement("label", { key: value, title: tooltip },
                react__rspack_import_3_default().createElement("input", { type: "radio", name: "correxit-mode", value: value, checked: mode === value, onChange: () => this.select(value), "aria-label": label, "aria-description": tooltip }),
                react__rspack_import_3_default().createElement("span", null, label))))),
            react__rspack_import_3_default().createElement("label", { className: "correxit-corrector-overwrite", title: trans.__('Re-process already certified workbooks') },
                react__rspack_import_3_default().createElement("input", { type: "checkbox", checked: overwrite, disabled: mode === 'scan', onChange: ({ target }) => this.set({ overwrite: target.checked }), "aria-label": trans.__('Overwrite already certified workbooks') }),
                react__rspack_import_3_default().createElement("span", null, trans.__('Overwrite'))),
            react__rspack_import_3_default().createElement("label", { className: "correxit-corrector-submitted", title: trans.__('Only include workbooks that were locally submitted') },
                react__rspack_import_3_default().createElement("input", { type: "checkbox", checked: submitted, disabled: mode === 'collect', onChange: ({ target }) => this.set({ submitted: target.checked }), "aria-label": trans.__('Only include locally submitted workbooks') }),
                react__rspack_import_3_default().createElement("span", null, trans.__('Submitted'))),
            react__rspack_import_3_default().createElement("button", { className: className, onClick: action, "aria-label": description }, label)));
    }
    reset() {
        this.select('scan');
        this.busy = false;
        this.overwrite = false;
        this.submitted = false;
        this.update();
    }
    set(updates) {
        const fields = 'overwrite' in updates || 'submitted' in updates;
        if ('overwrite' in updates && updates.overwrite !== undefined)
            this.overwrite = updates.overwrite;
        if ('submitted' in updates && updates.submitted !== undefined)
            this.submitted = updates.submitted;
        if (!fields) {
            const { graded, scanned } = updates;
            this.busy = !(graded && scanned);
        }
        this.update();
    }
    select(mode) {
        ___rspack_import_4.Corrector.Modes.forEach(mode => this.removeClass(`cxt-mod-${mode}`));
        this.addClass(`cxt-mod-${mode}`);
        this.mode = mode;
        this.update();
    }
}
class ReviewerWidget extends _jupyterlab_apputils__rspack_import_0.MainAreaWidget {
    constructor(options) {
        super({ content: new ReviewerContent(options) });
        this.addClass('correxit-reviewer-widget');
        this.initialize(options.commands, options.trans);
    }
    get workbook() {
        return this.content.workbook;
    }
    navigate(cursor) {
        this.content.set({ cursor });
    }
    move(direction) {
        this.content.move(direction);
    }
    score(action) {
        this.content.score(action);
    }
    dispose() {
        _correxit_state__rspack_import_7.cursor(null);
        super.dispose();
    }
    initialize(commands, trans) {
        const { toolbar } = this;
        const button = (id) => new _jupyterlab_ui_components__rspack_import_2.CommandToolbarButton({ commands, id, noFocusOnClick: true });
        toolbar.addItem('left', button(_commands__rspack_import_5.CommandIDs.left));
        toolbar.addItem('up', button(_commands__rspack_import_5.CommandIDs.up));
        toolbar.addItem('down', button(_commands__rspack_import_5.CommandIDs.down));
        toolbar.addItem('right', button(_commands__rspack_import_5.CommandIDs.right));
        toolbar.addItem('info', new ReviewerInfoWidget(trans));
    }
}
class ReviewerInfoWidget extends _jupyterlab_ui_components__rspack_import_2.ReactWidget {
    constructor(trans) {
        super();
        this.trans = trans;
        this.addClass('correxit-reviewer-info');
    }
    render() {
        return react__rspack_import_3_default().createElement(ReviewerInfo, { trans: this.trans });
    }
}
function ReviewerInfo({ trans }) {
    var _a;
    const { cursor, workbooks } = _bridge__rspack_import_8.useSnapshot();
    if (!cursor)
        return null;
    const workbook = workbooks.find((w) => !w.hollow && w.context.path === cursor.path);
    if (!workbook)
        return null;
    const rubric = _correxit__rspack_import_9.Workbook.open(workbook, true);
    if (!rubric)
        return null;
    const rows = workbook.context.model.sharedModel.cells
        .map(cell => cell.id)
        .filter(id => id in rubric.cells);
    const index = rows.indexOf(cursor.cell);
    if (index < 0)
        return null;
    const issue = rubric.assignment.issue.replace(/[^a-z0-9]/gi, '');
    const token = issue ? issue.slice(-6).toUpperCase() : `${index + 1}`;
    const score = (_a = _correxit__rspack_import_10.Rubric.Score.resolve(rubric.assignment.report, cursor.cell)) !== null && _a !== void 0 ? _a : null;
    return (react__rspack_import_3_default().createElement("span", null,
        trans.__('Review %1', token),
        ' \u00b7 ',
        trans.__('Cell %1 of %2', index + 1, rows.length),
        ' \u00b7 ',
        react__rspack_import_3_default().createElement(ScoreBadge, { report: rubric.assignment.report, cell: cursor.cell, score: score, trans: trans })));
}
function ScoreBadge(props) {
    const { report, cell, score, trans } = props;
    if (!score || score.status === 'unscored') {
        const className = 'correxit-reviewer-badge correxit-reviewer-badge-unscored';
        return react__rspack_import_3_default().createElement("span", { className: className },
            " ",
            trans.__('Unscored'));
    }
    const { interventions } = { ..._correxit__rspack_import_10.Rubric.Assignment.Report.empty(), ...report };
    const manual = cell in interventions;
    const source = manual ? trans.__('Manual') : trans.__('Auto');
    const status = score.status;
    const className = [
        'correxit-reviewer-badge',
        `correxit-reviewer-badge-${status}`,
        manual && 'correxit-reviewer-badge-manual'
    ]
        .filter(Boolean)
        .join(' ');
    return (react__rspack_import_3_default().createElement("span", { className: className, title: source },
        trans.__('%1/%2', score.points, score.possible),
        react__rspack_import_3_default().createElement("span", { className: "correxit-reviewer-badge-label" }, source)));
}
class ReviewerContent extends _jupyterlab_ui_components__rspack_import_2.ReactWidget {
    constructor(props) {
        super();
        this.workbook = null;
        this.props = {
            ...props,
            cursor: null,
            on: {
                navigate: ref => void (this.ref = ref),
                score: ref => void (this.scored = ref),
                workbook: workbook => void (this.workbook = workbook)
            }
        };
        this.ref = { current: () => { } };
        this.scored = { current: () => { } };
        this.addClass('correxit-reviewer-widget-content');
    }
    move(direction) {
        this.ref.current(direction);
    }
    render() {
        const { trans } = this.props;
        const label = trans.__('Something went wrong rendering the reviewer.');
        return (react__rspack_import_3_default().createElement(_ui__rspack_import_6.Boundary, { label: label },
            react__rspack_import_3_default().createElement(_reviewer__rspack_import_11.Reviewer, { ...this.props })));
    }
    score(action) {
        this.scored.current(action);
    }
    set(updates) {
        var _a;
        this.props = {
            ...this.props,
            cursor: (_a = updates.cursor) !== null && _a !== void 0 ? _a : this.props.cursor
        };
        this.update();
    }
}


},
"./lib/correxit/assignment.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Assignment: () => (Assignment)
});
/* import */ var _lumino_algorithm__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@lumino/algorithm");
/* import */ var _lumino_algorithm__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_lumino_algorithm__rspack_import_0);
/* import */ var _error__rspack_import_3 = __webpack_require__("./lib/correxit/error.js");
/* import */ var _rubric__rspack_import_1 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _security__rspack_import_2 = __webpack_require__("./lib/correxit/security.js");




/** Utilities for preparing and issuing serialized notebook assignments. */
var Assignment;
(function (Assignment) {
    /** Assign a serialized workbook to one assignee. */
    async function assign(options) {
        var _a, _b, _c;
        const source = copy(options.notebook);
        const locked = rubric(source);
        const key = await secret(options, locked.id);
        const unlocked = await _rubric__rspack_import_1.Rubric.unlock(locked, key);
        const roster = enroll((_a = options.roster) !== null && _a !== void 0 ? _a : unlocked.assignment.roster, options.assignee);
        const { encrypted, notebook } = await prepare(source, unlocked);
        const author = await _security__rspack_import_2.decrypt(locked.assignment.keys.private.author, key);
        const file = (_b = options.file) !== null && _b !== void 0 ? _b : (await filename(unlocked.assignment.name || unlocked.assignment.id || unlocked.id, options.assignee));
        const issued = await issue({
            assignee: options.assignee,
            author,
            distribution: (_c = options.distribution) !== null && _c !== void 0 ? _c : null,
            file,
            key,
            notebook,
            roster
        });
        const resources = unlocked.assignment.resources;
        return { encrypted, resources, ...issued };
    }
    Assignment.assign = assign;
    /** @returns a deterministic filename for an assigned workbook. */
    async function filename(assignment, assignee) {
        const name = assignment.replace(/[^\w.-]/g, '');
        const local = assignee.split('@')[0].replace(/[^\w.-]/g, '');
        const hash = (await _security__rspack_import_2.digest(assignee)).slice(0, 4);
        return `${name}-${local}-${hash}.ipynb`;
    }
    Assignment.filename = filename;
    /** Issue a prepared serialized workbook to one assignee. */
    async function issue(options) {
        var _a;
        const { assignee, author, distribution, file, key, notebook, roster } = options;
        const metadata = writable(notebook);
        const { expiration, id, keys, name, overdue, penalty, resources } = metadata.assignment;
        const report = _rubric__rspack_import_1.Rubric.Assignment.Report.empty();
        const fresh = lifecycle(expiration, distribution);
        const unsigned = {
            assignee,
            ...fresh,
            id,
            keys,
            name,
            overdue,
            penalty,
            report,
            resources,
            roster
        };
        const blank = {
            ...metadata.assignment,
            ...unsigned,
            mac: '',
            seal: null
        };
        const digest = await _rubric__rspack_import_1.Rubric.Assignment.issue({
            assignment: blank,
            notebook,
            rubric: metadata
        });
        const issuer = await _rubric__rspack_import_1.Rubric.Assignment.issuer(digest, author);
        const assignment = { ...blank, issue: digest, issuer };
        const unlocked = {
            assignment,
            cells: metadata.cells,
            cxtformat: metadata.cxtformat,
            id: metadata.id,
            key,
            locked: false,
            references: (_a = metadata.references) !== null && _a !== void 0 ? _a : {},
            revised: Date.now()
        };
        const mac = await _rubric__rspack_import_1.Rubric.mac(unlocked, key);
        const signed = { ...unlocked, assignment: { ...assignment, mac } };
        await _rubric__rspack_import_1.Rubric.validate(signed);
        const encrypted = await _security__rspack_import_2.encrypt(JSON.stringify(roster), key);
        metadata.assignment = {
            ...signed.assignment,
            roster: [encrypted]
        };
        metadata.revised = Date.now();
        return {
            identifier: {
                assignee,
                assignment: id,
                file,
                issue: digest,
                rubric: metadata.id
            },
            notebook
        };
    }
    Assignment.issue = issue;
    /** Prepare a serialized notebook as a reusable assignment template. */
    async function prepare(source, rubric) {
        var _a;
        audit(source, rubric);
        const encrypted = [];
        const notebook = copy(source);
        for (const reference of Object.values(rubric.references)) {
            if (!reference.secret)
                continue;
            await encrypt(notebook, reference.referent, rubric.key);
            encrypted.push(reference.referent);
        }
        for (const cell of notebook.cells) {
            const id = String((_a = cell.id) !== null && _a !== void 0 ? _a : '');
            if (_rubric__rspack_import_1.Rubric.has(rubric, id))
                continue;
            cell.metadata = { ...cell.metadata, editable: false };
        }
        return { encrypted, notebook };
    }
    Assignment.prepare = prepare;
    /** Stamp the distribution timestamp on a serialized notebook. */
    function stamp(notebook, distribution) {
        const metadata = writable(notebook);
        metadata.assignment = { ...metadata.assignment, distribution };
        metadata.revised = Date.now();
    }
    Assignment.stamp = stamp;
})(Assignment || (Assignment = {}));
function audit(notebook, rubric) {
    const types = Object.fromEntries(notebook.cells.map(cell => { var _a; return [String((_a = cell.id) !== null && _a !== void 0 ? _a : ''), cell.cell_type]; }));
    const executable = (id) => types[id] === 'code' || types[id] === 'raw';
    const missing = Object.values(rubric.cells).filter(cell => {
        if (cell.is === 'reviewable')
            return !(cell.id in types);
        if (cell.is === 'answerable' && !cell.payload.length)
            return true;
        return !executable(cell.id);
    });
    if (missing.length)
        throw new _error__rspack_import_3.Invalid('assign error: missing cells');
    const dangling = Object.values(rubric.references)
        .filter(reference => !executable(reference.referent));
    if (dangling.length)
        throw new _error__rspack_import_3.Invalid('assign error: missing references');
}
function copy(notebook) {
    return JSON.parse(JSON.stringify(notebook));
}
async function encrypt(notebook, reference, key) {
    const index = (0,_lumino_algorithm__rspack_import_0.findIndex)(notebook.cells, ({ id }) => id === reference);
    if (!key || index === -1)
        throw new _error__rspack_import_3.Encrypt('encrypt error');
    const cell = notebook.cells[index];
    const source = text(cell);
    const encrypted = _security__rspack_import_2.encrypted(source)
        ? source
        : await _security__rspack_import_2.encrypt(source, key);
    const jupyter = cell.metadata.jupyter || {};
    cell.cell_type = 'raw';
    cell.metadata = {
        ...cell.metadata,
        editable: false,
        jupyter: { ...jupyter, source_hidden: true }
    };
    cell.source = encrypted;
    delete cell.metadata.trusted;
}
function enroll(roster, assignee) {
    return Array.from(new Set([...roster, assignee]));
}
/** @returns initialized lifecycle stages for a propagated assignment. */
function lifecycle(expiration, distribution) {
    return {
        certification: null,
        collected: null,
        distribution,
        expiration,
        issue: '',
        issuer: '',
        submission: null,
        submitted: null
    };
}
async function secret({ key, passphrase }, id) {
    return key !== null && key !== void 0 ? key : _security__rspack_import_2.keygen(passphrase, id);
}
function text(cell) {
    return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}
function rubric(notebook) {
    const metadata = notebook.metadata['correxit'];
    return _rubric__rspack_import_1.Rubric.normalize(metadata);
}
function writable(notebook) {
    return notebook.metadata['correxit'];
}


},
"./lib/correxit/certificate.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  render: () => (render)
});
/* import */ var ___rspack_import_0 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _workbook__rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");


const ID = 'correxit-workbook-certificate';
const { has, timestamp } = ___rspack_import_0.Rubric;
/** Append or replace the score report cell in a certified workbook. */
function render(workbook, grade, trans) {
    var _a;
    const rubric = _workbook__rspack_import_1.Workbook.open(workbook, true);
    if (!rubric)
        return;
    const { assignee, certification, collected, name, report, submission, submitted } = rubric.assignment;
    const notebook = workbook.context.model.sharedModel;
    const cells = notebook.cells;
    const ordered = cells.map(({ id }) => id).filter(id => has(rubric, id));
    const position = Object.fromEntries(cells.map(({ id }, index) => [id, index + 1]));
    const preview = Object.fromEntries(cells.map(cell => {
        var _a;
        const line = (_a = cell.getSource().split('\n').find(line => line.trim())) !== null && _a !== void 0 ? _a : '';
        const trimmed = line.trim();
        return [cell.id, trimmed.length > 40
                ? trimmed.slice(0, 40) + '\u2026' : trimmed];
    }));
    const icon = (status) => status === 'correct' ? '\u2705'
        : status === 'incorrect' ? '\u274c'
            : status === 'partial' ? '\u26a0\ufe0f'
                : '--';
    const lines = [
        '---',
        '',
        `## ${trans.__('Score Report')}`,
        '',
        '| | |',
        '|---|---|',
        `| **${trans.__('Assignee')}** | ${assignee} |`,
        `| **${trans.__('Assignment')}** | ${name} |`,
        `| **${trans.__('Score')}** | ${grade.score.points}` +
            ` / ${grade.score.possible} |`,
    ];
    if (submission) {
        lines.push(`| **${trans.__('Submitted')}** | ${timestamp(submission)} |`);
        if (submitted)
            lines.push(`| **${trans.__('Receipt')}** | \`${submitted}\` |`);
    }
    lines.push(`| **${trans.__('Certified')}** | ${timestamp(certification, 'n/a')} |`);
    if (collected)
        lines.push(`| **${trans.__('Collected')}** | \`${collected}\` |`);
    if (grade.spec)
        lines.push(`| **${trans.__('Kernel')}** | ${grade.spec.display_name} |`);
    lines.push('');
    if (ordered.length) {
        lines.push(`| # | ${trans.__('Cell')} | ${trans.__('Type')}` +
            ` | ${trans.__('Score')} | ${trans.__('Status')}` +
            ` | ${trans.__('Comment')} |`, '|--:|---|---|---|---|---|');
        for (const id of ordered) {
            const cell = ___rspack_import_0.Rubric.get(rubric, id);
            const scored = ___rspack_import_0.Rubric.Score.resolve(report, id);
            const points = scored ? `${scored.points} / ${scored.possible}` : '–';
            const comment = (scored === null || scored === void 0 ? void 0 : scored.comment) || '';
            lines.push(`| ${position[id]}` +
                ` | \`${preview[id] || id}\`` +
                ` | ${cell.is}` +
                ` | ${points}` +
                ` | ${icon((_a = scored === null || scored === void 0 ? void 0 : scored.status) !== null && _a !== void 0 ? _a : 'unscored')}` +
                ` | ${comment} |`);
        }
        lines.push('');
    }
    const source = lines.join('\n');
    const metadata = { editable: false, trusted: true };
    const existing = cells.findIndex(cell => cell.id === ID);
    notebook.transact(() => {
        if (existing !== -1)
            notebook.deleteCell(existing);
        notebook.insertCell(existing !== -1 ? existing : cells.length, {
            cell_type: 'markdown',
            id: ID,
            metadata,
            source
        });
    }, false);
}


},
"./lib/correxit/collectors.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  manual: () => (manual)
});
/* import */ var ___rspack_import_0 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _security__rspack_import_1 = __webpack_require__("./lib/correxit/security.js");


/** Content-addressed digest receipt for a certified workbook grade. */
async function manual(certified) {
    var _a;
    const { grade, identifier } = certified;
    const { points, possible } = grade.score;
    const { assignee, issue, rubric: id } = identifier;
    const rubric = ___rspack_import_0.Workbook.open(certified.workbook, true);
    const certification = (_a = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.certification) !== null && _a !== void 0 ? _a : null;
    const payload = JSON.stringify({
        assignee, certification, issue, points, possible, rubric: id
    });
    return `manual:${await _security__rspack_import_1.digest(payload)}`;
}


},
"./lib/correxit/commands.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  CommandIDs: () => (CommandIDs),
  commands: () => (commands)
});
/* import */ var _jupyterlab_apputils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/apputils");
/* import */ var _jupyterlab_apputils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__rspack_import_0);
/* import */ var _jupyterlab_coreutils__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_1);
/* import */ var _jupyterlab_filebrowser__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/filebrowser");
/* import */ var _jupyterlab_filebrowser__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_filebrowser__rspack_import_2);
/* import */ var _jupyterlab_notebook__rspack_import_3 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/notebook");
/* import */ var _jupyterlab_notebook__rspack_import_3_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__rspack_import_3);
/* import */ var _lumino_algorithm__rspack_import_4 = __webpack_require__("webpack/sharing/consume/default/@lumino/algorithm");
/* import */ var _lumino_algorithm__rspack_import_4_default = /*#__PURE__*/__webpack_require__.n(_lumino_algorithm__rspack_import_4);
/* import */ var _lumino_widgets__rspack_import_5 = __webpack_require__("webpack/sharing/consume/default/@lumino/widgets");
/* import */ var _lumino_widgets__rspack_import_5_default = /*#__PURE__*/__webpack_require__.n(_lumino_widgets__rspack_import_5);
/* import */ var ___rspack_import_6 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_7 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_8 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _ui_propagator__rspack_import_15 = __webpack_require__("./lib/ui/propagator.js");
/* import */ var _input__rspack_import_10 = __webpack_require__("./lib/correxit/input.js");
/* import */ var _io__rspack_import_9 = __webpack_require__("./lib/correxit/io.js");
/* import */ var _nbgrader__rspack_import_13 = __webpack_require__("./lib/correxit/nbgrader.js");
/* import */ var _propagator__rspack_import_14 = __webpack_require__("./lib/correxit/propagator.js");
/* import */ var _security__rspack_import_12 = __webpack_require__("./lib/correxit/security.js");
/* import */ var _state__rspack_import_11 = __webpack_require__("./lib/correxit/state.js");














var CommandIDs;
(function (CommandIDs) {
    CommandIDs.assign = 'correxit:assign';
    CommandIDs.certify = 'correxit:certify';
    CommandIDs.collect = 'correxit:collect';
    CommandIDs.comment = 'correxit:comment';
    CommandIDs.configure = 'correxit:configure';
    CommandIDs.convert = 'correxit:convert';
    CommandIDs.correct = 'correxit:correct';
    CommandIDs.dereference = 'correxit:dereference';
    CommandIDs.distribute = 'correxit:distribute';
    CommandIDs.draft = 'correxit:draft';
    CommandIDs.enroll = 'correxit:enroll';
    CommandIDs.fetch = 'correxit:fetch';
    CommandIDs.inject = 'correxit:inject';
    CommandIDs.intervene = 'correxit:intervene';
    CommandIDs.launch = 'correxit:launch';
    CommandIDs.lock = 'correxit:lock';
    CommandIDs.propagate = 'correxit:propagate';
    CommandIDs.redistribute = 'correxit:redistribute';
    CommandIDs.refer = 'correxit:refer';
    CommandIDs.remove = 'correxit:remove';
    CommandIDs.reset = 'correxit:reset';
    CommandIDs.resource = 'correxit:resource';
    CommandIDs.revise = 'correxit:revise';
    CommandIDs.reweight = 'correxit:reweight';
    CommandIDs.save = 'correxit:save';
    CommandIDs.share = 'correxit:share';
    CommandIDs.submit = 'correxit:submit';
    CommandIDs.track = 'correxit:track';
    CommandIDs.unassign = 'correxit:unassign';
    CommandIDs.unlock = 'correxit:unlock';
})(CommandIDs || (CommandIDs = {}));
const { get, has } = ___rspack_import_6.Rubric;
const { acknowledge, add, assign, certify, collect, comment, convert, correct, dereference, distribute, draft, headed, headless, intervene, lock, recover, refer, remove, reset, restore, revise, reweight, submit, toggle } = ___rspack_import_7.Workbook;
const { normalize } = ___rspack_import_7.Workbook.Credentials;
function commands(app, utilities) {
    const { commands, serviceManager: manager, shell } = app;
    const { Error, Icons } = ___rspack_import_8.Correxit;
    const { collector, distributor, documents, injector, registrar, submitter, unlocker } = utilities;
    const trans = utilities.translator.load('correxit');
    const factory = new _jupyterlab_notebook__rspack_import_3.NotebookModelFactory();
    const fetch = (handle, silent = false) => _io__rspack_import_9.request(handle, factory, manager, unlocker, silent);
    const open = (workbook) => ___rspack_import_7.Workbook.open(workbook, true);
    const block = (rubric, id) => new Set([
        id,
        ...Object.keys(rubric.cells),
        ...Object.keys(rubric.references)
    ]);
    const choose = (workbook, rubric, id) => _input__rspack_import_10.cell(workbook, {
        blocked: block(rubric, id),
        empty: trans.__('No code cells available.'),
        id,
        message: ({ index, valid }) => valid
            ? trans.__('Cell %1 selected.', index)
            : trans.__('Cell %1 is unavailable.', index),
        prompt: trans.__('↑ ↓ to move, Enter to confirm, Escape to cancel.'),
        title: trans.__('Choose a reference cell')
    });
    const current = () => shell.currentWidget instanceof _jupyterlab_notebook__rspack_import_3.NotebookPanel ? shell.currentWidget : null;
    const active = () => {
        const workbook = _state__rspack_import_11.workbook();
        if (___rspack_import_7.Workbook.headed(workbook) && !workbook.context.isDisposed)
            return workbook;
        if (workbook === null || workbook === void 0 ? void 0 : workbook.context.isDisposed)
            _state__rspack_import_11.workbook(null);
        return current();
    };
    const files = (paths, parent) => {
        const folder = parent || '.';
        const root = _jupyterlab_coreutils__rspack_import_1.PathExt.resolve(folder || '.');
        const files = Array.from(new Set(paths.map(path => {
            const full = _jupyterlab_coreutils__rspack_import_1.PathExt.resolve(path);
            if (full === root) {
                throw new Error.Invalid(trans.__('Select one or more files in "%1".', folder));
            }
            const name = _jupyterlab_coreutils__rspack_import_1.PathExt.basename(path);
            if (_jupyterlab_coreutils__rspack_import_1.PathExt.resolve(folder, name) !== full) {
                throw new Error.Invalid(trans.__('Files must be in (%1). Move or copy them there to select them.', folder));
            }
            return name;
        })));
        return files.length ? files : null;
    };
    const outputs = (workbook, rubric) => {
        const secrets = new Set(Object.values(rubric.references)
            .filter(({ secret }) => secret)
            .map(({ referent }) => referent));
        return workbook.context.model.sharedModel.toJSON().cells.flatMap(cell => {
            const { id, outputs } = cell;
            return id && secrets.has(id) && Array.isArray(outputs) && outputs.length
                ? [id]
                : [];
        });
    };
    const reify = async (args) => {
        const handle = normalize(args);
        const workbook = handle
            ? await fetch(handle)
            : active();
        const rubric = open(workbook);
        return { handle, rubric, workbook };
    };
    const deliver = async (args) => {
        const current = _state__rspack_import_11.workbook();
        const path = args.path || (current === null || current === void 0 ? void 0 : current.context.path) || '';
        const handle = path && normalize({ path });
        if (!path || !handle) {
            const error = 'distribute error: invalid path';
            return { assignee: path, error, ok: false, path };
        }
        const active = (current === null || current === void 0 ? void 0 : current.context.path) === path ? current : null;
        const workbook = active || await fetch(handle, !!args.silent);
        if (!workbook) {
            const error = 'distribute error: workbook unavailable';
            return { assignee: path, error, ok: false, path };
        }
        let assignee = path;
        try {
            const rubric = open(workbook);
            if (!rubric)
                throw new Error.Invalid('distribute error: invalid rubric');
            const identifier = ___rspack_import_7.Workbook.identifier(workbook);
            if (!___rspack_import_7.Workbook.Identifier.assigned(identifier))
                throw new Error.Invalid('distribute error: unassigned');
            assignee = identifier.assignee;
            if (!(await ___rspack_import_7.Workbook.unstarted(workbook)))
                throw new Error.Invalid('distribute error: unstarted must be true');
            if (rubric.assignment.distribution !== null)
                return { assignee, error: null, ok: true, path };
            const notebook = workbook.context.model.sharedModel.toJSON();
            const directory = _jupyterlab_coreutils__rspack_import_1.PathExt.dirname(path);
            const load = async (name) => ({ name, data: await _io__rspack_import_9.load(manager, directory, name) });
            const names = rubric.assignment.resources;
            const resources = names ? await Promise.all(names.map(load)) : null;
            const overwrite = true;
            await distributor({ identifier, notebook, overwrite, path, resources });
            await distribute(workbook);
            await workbook.context.save();
            return { assignee, error: null, ok: true, path };
        }
        catch (error) {
            const reason = `${error}`;
            if (args.quiet)
                console.warn(CommandIDs.distribute, error);
            else
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            return { assignee, error: reason, ok: false, path };
        }
        finally {
            if (!active)
                workbook.context.dispose();
        }
    };
    const pending = async (directory) => {
        if (!directory)
            return [];
        const current = _state__rspack_import_11.workbook();
        try {
            const notebooks = await _io__rspack_import_9.notebooks(manager, directory);
            const paths = [];
            for (const { path } of notebooks) {
                const active = (current === null || current === void 0 ? void 0 : current.context.path) === path ? current : null;
                const handle = normalize({ path });
                const workbook = active || (handle && await fetch(handle, true));
                if (!workbook)
                    continue;
                try {
                    const rubric = open(workbook);
                    if ((rubric === null || rubric === void 0 ? void 0 : rubric.assignment.distribution) === null)
                        paths.push(path);
                }
                finally {
                    if (!active)
                        workbook.context.dispose();
                }
            }
            return paths;
        }
        catch (error) {
            console.warn(CommandIDs.redistribute, directory, error);
            return [];
        }
    };
    const redistribute = async function* (directory, paths) {
        paths = paths.length ? paths : await pending(directory);
        const total = paths.length;
        if (!total)
            return;
        let progress = 0;
        yield { type: 'separator', slots: [] };
        for (const path of paths) {
            const result = await deliver({ path, quiet: true, silent: true });
            if (result.ok) {
                yield { type: 'distributed', slots: [result.assignee, result.path] };
            }
            else {
                yield {
                    type: 'distribute-error',
                    slots: [result.assignee, result.path, result.error || '']
                };
            }
            yield { type: 'progress', slots: [++progress, total] };
        }
        yield { type: 'retried', slots: [total] };
    };
    const disposables = [];
    disposables.push(commands.addCommand(CommandIDs.assign, {
        icon: Icons.assignment,
        isEnabled: () => { var _a; return ((_a = open(_state__rspack_import_11.workbook())) === null || _a === void 0 ? void 0 : _a.locked) === false; },
        isVisible: () => commands.isEnabled(CommandIDs.assign),
        label: trans.__('Assign workbook...'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric)
                return;
            await assign(workbook, args);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.unassign, {
        icon: Icons.remove,
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            return !!rubric && !rubric.locked && !!rubric.assignment.assignee;
        },
        isVisible: () => commands.isEnabled(CommandIDs.unassign),
        label: trans.__('Clear assignee'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric)
                return;
            const title = trans.__('Clear assignee');
            const body = trans.__('Clear assignee "%1"?', rubric.assignment.assignee);
            const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({ body, title });
            if (!button.accept)
                return;
            await assign(workbook, { assignee: '' });
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.resource, {
        icon: Icons.assignment,
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            return !!rubric && !rubric.locked && !rubric.assignment.assignee;
        },
        isVisible: () => commands.isEnabled(CommandIDs.resource),
        label: trans.__('Set resources...'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric || rubric.locked || rubric.assignment.assignee)
                return;
            const directory = _jupyterlab_coreutils__rspack_import_1.PathExt.dirname(workbook.context.path) || '.';
            try {
                if ('resources' in args) {
                    const resources = args.resources && files(args.resources, directory);
                    await assign(workbook, { resources });
                    return;
                }
                const filter = (item) => item.type === 'file' &&
                    _jupyterlab_coreutils__rspack_import_1.PathExt.resolve(item.path) === _jupyterlab_coreutils__rspack_import_1.PathExt.resolve(directory, item.name)
                    ? {} : null;
                const { button, value } = await _jupyterlab_filebrowser__rspack_import_2.FileDialog.getOpenFiles({
                    defaultPath: directory,
                    filter,
                    label: trans.__('Select files in "%1" to distribute.', directory),
                    manager: documents,
                    title: trans.__('Select resource files'),
                    translator: utilities.translator
                });
                if (!button.accept)
                    return;
                const paths = (value || []).map(item => {
                    if (item.type !== 'file') {
                        const message = trans.__('Select one or more files in "%1".', directory);
                        throw new Error.Invalid(message);
                    }
                    return item.path;
                });
                const resources = files(paths, directory);
                await assign(workbook, { resources });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.certify, {
        icon: Icons.certify,
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            const assigned = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.assignee);
            return assigned && !rubric.locked;
        },
        label: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            return (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.certification)
                ? trans.__('Recertify workbook...')
                : trans.__('Certify workbook...');
        },
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric || rubric.locked || !rubric.assignment.assignee)
                return;
            try {
                await certify(workbook, trans);
                await commands.execute(CommandIDs.save, { ...args, undo: false });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.collect, {
        icon: Icons.certify,
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            const assigned = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.assignee);
            const certified = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.certification);
            const collected = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.collected);
            return assigned && !rubric.locked && certified && !collected;
        },
        label: trans.__('Collect workbook...'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric || rubric.locked || !rubric.assignment.assignee)
                return;
            try {
                const certified = await certify(workbook, trans, true);
                const receipt = await collector(certified);
                await collect(workbook, receipt);
                await commands.execute(CommandIDs.save, { ...args, undo: false });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.comment, {
        label: trans.__('Comment on cell'),
        execute: async (args) => {
            const workbook = _state__rspack_import_11.workbook();
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(workbook);
            if (!workbook || !id || !rubric)
                return;
            await comment(workbook, id, args.comment || '');
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.configure, {
        className: 'correxit-configure',
        icon: ({ is }) => is && Icons[is] || undefined,
        isEnabled: (args) => {
            var _a;
            const workbook = active();
            const notebook = workbook === null || workbook === void 0 ? void 0 : workbook.context.model.sharedModel;
            const id = _state__rspack_import_11.cell(args);
            const cell = (0,_lumino_algorithm__rspack_import_4.find)((notebook === null || notebook === void 0 ? void 0 : notebook.cells) || [], cell => cell.id === id);
            const references = args.references;
            const rubric = open(workbook);
            if (!cell || !rubric || !id || (references === null || references === void 0 ? void 0 : references.includes(id)))
                return false;
            if (rubric.locked || rubric.assignment.assignee)
                return false;
            if (has(rubric, id))
                return ((_a = get(rubric, id)) === null || _a === void 0 ? void 0 : _a.is) === args.is;
            const code = cell.cell_type === 'code';
            if (!code)
                return args.is === 'reviewable';
            return !(id in rubric.references);
        },
        isToggled: (args) => {
            var _a;
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(active());
            return !!rubric && !!id && ((_a = get(rubric, id)) === null || _a === void 0 ? void 0 : _a.is) === args.is;
        },
        isVisible: (args) => {
            var _a;
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(active());
            if (!id || !rubric)
                return false;
            if (rubric.locked || rubric.assignment.assignee)
                return false;
            if (has(rubric, id))
                return ((_a = get(rubric, id)) === null || _a === void 0 ? void 0 : _a.is) === args.is;
            return commands.isEnabled(CommandIDs.configure, args);
        },
        caption: (cell) => {
            if (cell.is === 'answerable')
                return trans.__('Has known answer');
            if (cell.is === 'comparable')
                return trans.__('Compares to reference');
            if (cell.is === 'correctable')
                return trans.__('Executes correction');
            if (cell.is === 'reviewable')
                return trans.__('Needs manual review');
            return '';
        },
        label: (cell) => {
            if (cell.is === 'answerable')
                return trans.__('Answer');
            if (cell.is === 'comparable')
                return trans.__('Compare');
            if (cell.is === 'correctable')
                return trans.__('Correct');
            if (cell.is === 'reviewable')
                return trans.__('Manual');
            return '';
        },
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            const id = _state__rspack_import_11.cell(args);
            const is = args.is;
            if (!rubric || !id || !is || rubric.locked)
                return;
            const confirm = () => (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                title: trans.__('Reset cell configuration?'),
                body: trans.__('Do you want to replace the existing configuration?'),
                buttons: [
                    _jupyterlab_apputils__rspack_import_0.Dialog.cancelButton({ label: trans.__('No') }),
                    _jupyterlab_apputils__rspack_import_0.Dialog.okButton({ label: trans.__('Yes') })
                ]
            });
            if (has(rubric, id)) {
                if (!(await confirm()).button.accept)
                    return;
                await remove(workbook, id);
            }
            if (is === 'answerable') {
                const expected = await _input__rspack_import_10.text({
                    title: trans.__('Enter expected cell output'),
                    label: commands.label(CommandIDs.configure, args)
                });
                if (!expected)
                    return;
                const payload = [await _security__rspack_import_12.digest(expected)];
                const points = 1;
                const references = null;
                await add(workbook, { id, is, payload, points, references });
                return;
            }
            if (is === 'reviewable') {
                const payload = null;
                const points = 1;
                const references = null;
                await add(workbook, { id, is, payload, points, references });
                return;
            }
            if (is !== 'comparable' && is !== 'correctable')
                return;
            let references = args.references || null;
            if (!references) {
                const rubric = open(workbook);
                if (!rubric || rubric.locked)
                    return;
                const selected = headed(workbook)
                    ? await choose(workbook, rubric, id)
                    : null;
                references = selected && [selected.id];
            }
            if (!references || references.includes(id))
                return;
            if (headed(workbook)) {
                const { widgets } = workbook.content;
                const original = (0,_lumino_algorithm__rspack_import_4.find)(widgets, ({ model }) => model.id === id);
                if (original)
                    await workbook.content.scrollToCell(original);
            }
            const payload = null;
            const points = 1;
            await add(workbook, { id, is, payload, points, references }, references.map(referent => ({ cell: id, referent, points: 1, secret: true })));
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.convert, {
        icon: Icons.convert,
        isEnabled: () => {
            try {
                void ___rspack_import_7.Workbook.open(_state__rspack_import_11.workbook());
                return false;
            }
            catch (error) {
                return error === ___rspack_import_8.Correxit.NO_CORREXIT_METADATA;
            }
        },
        isVisible: () => commands.isEnabled(CommandIDs.convert),
        label: trans.__('Convert to a workbook assignment...'),
        execute: async (args) => {
            var _a, _b;
            const { workbook } = await reify(args);
            if (!workbook)
                return;
            const notebook = workbook.context.model.sharedModel;
            const detected = _nbgrader__rspack_import_13.detect(notebook.cells.map(cell => ({
                id: cell.id,
                cell_type: cell.cell_type,
                source: cell.getSource(),
                metadata: cell.toJSON().metadata
            })));
            if (detected) {
                const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                    title: trans.__('Convert nbgrader notebook?'),
                    body: trans.__(`This rewrites the current notebook in place as a Correxit workbook.
If conversion fails, Correxit restores the original notebook.`),
                    buttons: [
                        _jupyterlab_apputils__rspack_import_0.Dialog.cancelButton({ label: trans.__('Cancel') }),
                        _jupyterlab_apputils__rspack_import_0.Dialog.okButton({ label: trans.__('Convert') })
                    ]
                });
                if (!button.accept)
                    return;
            }
            const passphrase = await _input__rspack_import_10.text({
                title: trans.__('Enter a passphrase'),
                label: trans.__('Enter a passphrase for this workbook')
            });
            if (!passphrase)
                return;
            const snapshot = workbook.context.model.toJSON();
            const overlay = document.createElement('div');
            const converting = trans.__('Converting...');
            overlay.classList.add('correxit-overlay', 'cxt-mod-loading');
            overlay.dataset.label = converting;
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.setAttribute('aria-label', converting);
            (_b = (_a = workbook.content) === null || _a === void 0 ? void 0 : _a.node.parentElement) === null || _b === void 0 ? void 0 : _b.appendChild(overlay);
            let report;
            try {
                await convert(workbook, passphrase, unlocker);
                report = await _nbgrader__rspack_import_13.convert(workbook, trans);
            }
            catch (error) {
                restore(workbook, snapshot);
                const restored = trans.__('The original notebook was restored.');
                const detail = Error.reason(error);
                void (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(trans.__('Conversion failed; original notebook restored'), new globalThis.Error(`${restored}\n\n${detail}`));
                return;
            }
            finally {
                overlay.remove();
            }
            if (!report)
                return;
            const node = document.createElement('span');
            report.forEach((line, i) => {
                if (i > 0)
                    node.appendChild(document.createElement('br'));
                node.appendChild(document.createTextNode(line));
            });
            void (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                title: trans.__('Conversion summary'),
                body: new _lumino_widgets__rspack_import_5.Widget({ node }),
                buttons: [_jupyterlab_apputils__rspack_import_0.Dialog.okButton({ label: trans.__('Continue') })]
            });
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.correct, {
        icon: Icons.correct,
        isEnabled: (args) => {
            const workbook = _state__rspack_import_11.workbook();
            const rubric = open(workbook);
            const id = _state__rspack_import_11.cell(args);
            if (args[___rspack_import_6.Rubric.Cell.TOOLBAR] && !id)
                return false;
            if (!rubric || !headed(workbook))
                return false;
            if (!id) {
                const cells = Object.values(rubric.cells);
                const references = rubric.references;
                return cells.some(({ id, is }) => {
                    if (is === 'reviewable')
                        return false;
                    if (!rubric.locked)
                        return true;
                    const refs = Object.values(references)
                        .filter(({ cell }) => cell === id);
                    return !refs.length || refs.some(({ secret }) => !secret);
                });
            }
            const cell = get(rubric, id);
            if (!cell || cell.is === 'reviewable')
                return false;
            if (!rubric.locked)
                return true;
            const references = Object.values(rubric.references)
                .filter(reference => reference.cell === id);
            return !references.length || references.some(reference => !reference.secret);
        },
        isVisible: args => commands.isEnabled(CommandIDs.correct, args),
        label: (args) => {
            if (!commands.isEnabled(CommandIDs.correct, args))
                return '';
            return _state__rspack_import_11.cell(args)
                ? trans.__('Correct cell...')
                : trans.__('Correct workbook...');
        },
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric)
                return { resolved: false, score: ___rspack_import_6.Rubric.Score.UNSCORED, spec: null };
            const id = _state__rspack_import_11.cell(args);
            if (args[___rspack_import_6.Rubric.Cell.TOOLBAR] && !id)
                return { resolved: true, score: ___rspack_import_6.Rubric.Score.UNSCORED, spec: null };
            const result = await correct(workbook, id);
            if (headless(workbook))
                return result;
            const unscored = result.score.status === 'unscored';
            const [x, y] = [result.score.points, result.score.possible];
            void (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                title: trans.__('Computed score'),
                body: unscored ? trans.__('Unscored') : trans.__('%1 of %2', x, y)
            });
            if (workbook.content.activeCell)
                workbook.content.scrollToCell(workbook.content.activeCell);
            if (rubric.locked)
                _state__rspack_import_11.refresh();
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.dereference, {
        icon: Icons.remove,
        isEnabled: (args) => {
            const rubric = open(_state__rspack_import_11.workbook());
            if (!rubric || rubric.locked)
                return false;
            if (rubric.assignment.assignee)
                return false;
            return !!args.referent && args.referent in rubric.references;
        },
        isVisible: args => commands.isEnabled(CommandIDs.dereference, args),
        label: trans.__('Remove reference'),
        execute: async (args) => {
            const workbook = _state__rspack_import_11.workbook();
            if (!workbook || !args.referent)
                return;
            dereference(workbook, args.referent);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.distribute, {
        icon: Icons.assignment,
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            return !!((rubric === null || rubric === void 0 ? void 0 : rubric.assignment.assignee) &&
                rubric.assignment.issue &&
                rubric.assignment.issuer &&
                rubric.assignment.distribution === null);
        },
        isVisible: () => commands.isEnabled(CommandIDs.distribute),
        label: trans.__('Distribute assignment...'),
        execute: async (args) => (await deliver(args)).ok
    }));
    disposables.push(commands.addCommand(CommandIDs.draft, {
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            const submitted = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.submission);
            const certified = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.certification);
            const sealed = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.seal);
            return !!(rubric === null || rubric === void 0 ? void 0 : rubric.locked) && submitted && !certified && !sealed;
        },
        isVisible: () => commands.isEnabled(CommandIDs.draft),
        label: trans.__('Revert to draft...'),
        execute: async (args) => {
            const { workbook } = await reify(args);
            if (!workbook)
                return;
            const title = trans.__('Revert to draft');
            const body = trans.__('Revert read-only submission to draft workbook?');
            const buttons = [
                _jupyterlab_apputils__rspack_import_0.Dialog.cancelButton({ label: trans.__('Cancel') }),
                _jupyterlab_apputils__rspack_import_0.Dialog.okButton({ label: trans.__('Revert') })
            ];
            const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({ title, body, buttons });
            if (!button.accept)
                return;
            try {
                await draft(workbook);
                await commands.execute(CommandIDs.save, { ...args, undo: false });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.fetch, {
        label: trans.__('Fetch a headless Correxit workbook for a given path'),
        execute: async (args) => {
            const handle = normalize(args);
            try {
                return handle && await fetch(handle, !!args.silent);
            }
            catch (error) {
                console.warn(CommandIDs.fetch, error);
                return null;
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.inject, {
        label: trans.__('Inject one Correxit monitor emission'),
        execute: () => (fired => {
            return (emission) => {
                if (fired)
                    return;
                fired = true;
                injector(emission);
            };
        })(false)
    }));
    disposables.push(commands.addCommand(CommandIDs.intervene, {
        label: trans.__('Manually set cell score'),
        execute: async (args) => {
            const workbook = _state__rspack_import_11.workbook();
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(workbook);
            if (!workbook || !id || !rubric)
                return;
            if (args.intervention !== undefined)
                await intervene(workbook, id, args.intervention);
            await commands.execute(CommandIDs.save, { undo: false });
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.lock, {
        icon: Icons.locked,
        isEnabled: () => {
            const workbook = _state__rspack_import_11.workbook();
            const rubric = open(workbook);
            return !!(headed(workbook) && rubric && !rubric.locked);
        },
        isVisible: () => commands.isEnabled(CommandIDs.lock),
        label: trans.__('Lock'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric)
                return;
            try {
                await lock(workbook);
                await commands.execute(CommandIDs.save, { ...args, undo: false });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.propagate, {
        label: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            if (!rubric)
                return '';
            const total = rubric.assignment.roster.length;
            return trans.__('Create %1 assigned workbooks...', total);
        },
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            if (!rubric)
                return false;
            const { locked, assignment: { assignee, roster } } = rubric;
            return !locked && !!roster.length && !assignee;
        },
        isVisible: () => commands.isEnabled(CommandIDs.propagate),
        execute: async (args) => {
            var _a;
            const { rubric, workbook } = await reify(args);
            if (!rubric || rubric.locked)
                return (async function* empty() { })();
            const exposed = outputs(workbook, rubric);
            if (exposed.length) {
                const body = [
                    trans.__('Secret reference cells have outputs.'),
                    trans.__('Those outputs are not encrypted and will be distributed.')
                ].join(' ');
                const title = trans.__('Distribute visible outputs?');
                const buttons = [
                    _jupyterlab_apputils__rspack_import_0.Dialog.cancelButton({ label: trans.__('Cancel') }),
                    _jupyterlab_apputils__rspack_import_0.Dialog.okButton({ label: trans.__('Distribute') })
                ];
                const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({ body, buttons, title });
                if (!button.accept)
                    return (async function* empty() { })();
            }
            try {
                const { propagate } = _propagator__rspack_import_14;
                const configuration = { commands, distributor, factory, manager };
                const content = { overwrite: (_a = args.overwrite) !== null && _a !== void 0 ? _a : true, workbook };
                return translate(propagate({ ...configuration, ...content }), trans);
            }
            catch (error) {
                console.warn(CommandIDs.propagate, error);
            }
            return (async function* empty() { })();
        }
    }));
    let busy = false;
    let serial = 0;
    disposables.push(commands.addCommand(CommandIDs.track, {
        icon: Icons.assignment,
        label: () => commands.label(CommandIDs.propagate),
        isEnabled: () => !busy && commands.isEnabled(CommandIDs.propagate),
        isVisible: () => commands.isEnabled(CommandIDs.propagate),
        execute: ({ overwrite = false }) => {
            if (busy)
                return;
            busy = true;
            commands.notifyCommandChanged(CommandIDs.track);
            const rubric = open(_state__rspack_import_11.workbook());
            const name = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.name) || '';
            const roster = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment.roster.length) || 0;
            const title = roster
                ? trans.__('%1 (roster: %2)', name, roster)
                : name || trans.__('Creating assigned workbooks');
            const release = () => {
                if (!busy)
                    return;
                busy = false;
                commands.notifyCommandChanged(CommandIDs.track);
            };
            const refocus = () => shell.activateById('correxit-sidebar');
            const options = { commands, overwrite, refocus, release, trans };
            const widget = new _ui_propagator__rspack_import_15.Propagator.Widget(options);
            widget.id = `correxit-propagator-${++serial}`;
            widget.title.caption = title;
            widget.title.icon = Icons.assignment;
            shell.add(widget, 'right', {});
            shell.activateById(widget.id);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.enroll, {
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric)
                return null;
            const warn = (error) => {
                console.warn('enroll failed for workbook', workbook, error);
                return null;
            };
            const identifier = ___rspack_import_7.Workbook.identifier(workbook);
            return await registrar(workbook, identifier).catch(warn);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.redistribute, {
        label: trans.__('Retry distribution'),
        execute: async (args) => {
            return translate(redistribute(args.path || '', args.paths || []), trans);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.refer, {
        icon: Icons.refer,
        isEnabled: (args) => {
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(_state__rspack_import_11.workbook());
            if (!id || !rubric || rubric.locked)
                return false;
            if (rubric.assignment.assignee)
                return false;
            const cell = get(rubric, id);
            if (!cell)
                return false;
            if (cell.is === 'correctable')
                return true;
            return cell.is === 'comparable' && !cell.references.length;
        },
        isVisible: args => commands.isEnabled(CommandIDs.refer, args),
        label: trans.__('Add a reference cell'),
        execute: async (args) => {
            var _a, _b;
            const { rubric: unmodified, workbook } = await reify(args);
            const id = _state__rspack_import_11.cell(args);
            if (!unmodified || !id || unmodified.locked || !headed(workbook))
                return;
            const { id: referent } = (_a = await choose(workbook, unmodified, id)) !== null && _a !== void 0 ? _a : {};
            if (!referent)
                return;
            const rubric = open(workbook);
            if (!rubric || rubric.locked)
                return;
            const { is } = (_b = get(rubric, id)) !== null && _b !== void 0 ? _b : {};
            if (!is || is !== 'comparable' && is !== 'correctable')
                return;
            if (referent === id ||
                referent in rubric.references ||
                referent in rubric.cells)
                return;
            const reference = { cell: id, referent, points: 1, secret: true };
            await refer(workbook, id, reference);
            const { widgets } = workbook.content;
            const original = (0,_lumino_algorithm__rspack_import_4.find)(widgets, ({ model }) => model.id === id);
            if (original)
                await workbook.content.scrollToCell(original);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.remove, {
        className: 'correxit-remove',
        isEnabled: (args) => {
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(_state__rspack_import_11.workbook());
            if (!id || !rubric || rubric.locked || rubric.assignment.assignee)
                return false;
            return has(rubric, id);
        },
        isVisible: args => commands.isEnabled(CommandIDs.remove, args),
        icon: Icons.remove,
        label: trans.__('Reset cell'),
        execute: async (args) => {
            const workbook = _state__rspack_import_11.workbook();
            const id = _state__rspack_import_11.cell(args);
            if (workbook && id)
                remove(workbook, id);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.reset, {
        icon: Icons.reset,
        isEnabled: () => {
            const workbook = _state__rspack_import_11.workbook();
            const rubric = open(workbook);
            if (rubric)
                return !rubric.locked && !rubric.assignment.assignee;
            const notebook = workbook === null || workbook === void 0 ? void 0 : workbook.context.model.sharedModel;
            return !!(notebook === null || notebook === void 0 ? void 0 : notebook.getMetadata('correxit'));
        },
        isVisible: () => commands.isEnabled(CommandIDs.reset),
        caption: trans.__('Deletes Correxit metadata, keeps notebook content'),
        label: trans.__('Revert to notebook...'),
        execute: async (args) => {
            var _a;
            const { workbook } = await reify(args);
            if (!workbook)
                return;
            const notebook = workbook.context.model.sharedModel;
            const encrypted = notebook.cells.some(cell => _security__rspack_import_12.encrypted(cell.getSource()));
            if (encrypted) {
                const passphrase = (_a = args.key) !== null && _a !== void 0 ? _a : await _input__rspack_import_10.text({
                    title: trans.__('Recover encrypted cells'),
                    label: trans.__('Enter a passphrase to attempt decryption')
                });
                if (passphrase) {
                    const recovered = await recover(workbook, passphrase);
                    if (!recovered) {
                        const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                            title: trans.__('Recovery failed'),
                            body: trans.__('No cells could be decrypted. Reset anyway?')
                        });
                        if (!button.accept)
                            return;
                    }
                }
                else {
                    const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                        title: trans.__('Revert to notebook'),
                        body: trans.__('Encrypted cells were detected. Reset without recovering?')
                    });
                    if (!button.accept)
                        return;
                }
            }
            else {
                const title = trans.__('Revert to notebook');
                const body = commands.caption(CommandIDs.reset);
                const { button } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({ body, title });
                if (!button.accept)
                    return;
            }
            await reset(workbook);
            await commands.execute(CommandIDs.save, { ...args, undo: false });
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.reweight, {
        label: trans.__('Update points'),
        execute: async (args) => {
            const workbook = _state__rspack_import_11.workbook();
            const id = args.id || _state__rspack_import_11.cell(args);
            if (workbook && id && typeof args.points === 'number')
                await reweight(workbook, id, args.points);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.save, {
        icon: Icons.save,
        label: trans.__('Save workbook metadata'),
        execute: async (args) => {
            const { handle, workbook } = await reify(args);
            if (!workbook || workbook.context.isDisposed) {
                console.warn('save failed for (handle, workbook)', handle, workbook);
                return;
            }
            if (args.undo === false) {
                const notebook = workbook.context.model.sharedModel;
                notebook.clearUndoHistory();
            }
            await workbook.context.save();
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.share, {
        icon: (args) => {
            if (!commands.isEnabled(CommandIDs.share, args))
                return undefined;
            const rubric = open(_state__rspack_import_11.workbook());
            const id = _state__rspack_import_11.cell(args);
            const reference = rubric.references[id];
            return reference.secret ? Icons.secret : Icons.shared;
        },
        isEnabled: (args) => {
            const id = _state__rspack_import_11.cell(args);
            const rubric = open(_state__rspack_import_11.workbook());
            if (!id || !rubric || rubric.locked || rubric.assignment.assignee)
                return false;
            return id in rubric.references;
        },
        isVisible: args => commands.isEnabled(CommandIDs.share, args),
        label: (args) => {
            if (!commands.isEnabled(CommandIDs.share, args))
                return '';
            const rubric = open(_state__rspack_import_11.workbook());
            const id = _state__rspack_import_11.cell(args);
            const reference = rubric.references[id];
            return reference.secret
                ? trans.__('Mode: secret')
                : trans.__('Mode: shared');
        },
        execute: async (args) => {
            if (!commands.isEnabled(CommandIDs.share, args))
                return;
            const id = _state__rspack_import_11.cell(args);
            await toggle(_state__rspack_import_11.workbook(), id);
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.submit, {
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            const locked = !!(rubric === null || rubric === void 0 ? void 0 : rubric.locked);
            const assigned = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.assignee);
            const sealed = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.submission);
            const receipt = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.submitted);
            const certified = !!(rubric === null || rubric === void 0 ? void 0 : rubric.assignment.certification);
            return locked && assigned && !certified && (!sealed || !receipt);
        },
        isVisible: () => commands.isEnabled(CommandIDs.submit),
        label: trans.__('Submit assignment...'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!rubric)
                return;
            const identifier = ___rspack_import_7.Workbook.identifier(workbook);
            if (!___rspack_import_7.Workbook.Identifier.assigned(identifier))
                return;
            if (rubric.assignment.submission && !rubric.assignment.submitted) {
                try {
                    const receipt = await submitter(workbook, identifier);
                    await acknowledge(workbook, receipt);
                    await commands.execute(CommandIDs.save, { ...args, undo: false });
                }
                catch (error) {
                    (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
                }
                return;
            }
            const title = trans.__('Submit assignment');
            const body = trans.__(`Would you like to set a passphrase to revise your submission later?
Or do you just want to seal and submit? This document will be locked.`);
            const { button: { accept, actions } } = await (0,_jupyterlab_apputils__rspack_import_0.showDialog)({
                title,
                body,
                buttons: [
                    _jupyterlab_apputils__rspack_import_0.Dialog.cancelButton({ label: trans.__('Cancel') }),
                    _jupyterlab_apputils__rspack_import_0.Dialog.okButton({
                        className: 'jp-mod-styled correxit-dialog-revert',
                        label: trans.__('Submit without passphrase')
                    }),
                    _jupyterlab_apputils__rspack_import_0.Dialog.okButton({
                        className: 'jp-mod-styled',
                        label: trans.__('Set passphrase'),
                        actions: ['passphrase']
                    })
                ]
            });
            if (!accept)
                return;
            const passphrase = actions.includes('passphrase')
                ? await _input__rspack_import_10.text({
                    title: trans.__('Set a submission passphrase'),
                    label: trans.__('Enter a passphrase to seal your submission')
                })
                : null;
            if (actions.includes('passphrase') && !passphrase)
                return;
            try {
                const recipients = await ___rspack_import_7.Workbook.recipients(workbook, passphrase);
                await submit(workbook, recipients);
                try {
                    const receipt = await submitter(workbook, identifier);
                    await acknowledge(workbook, receipt);
                }
                catch (error) {
                    const reason = Error.reason(error);
                    const message = `Submission sealed but receipt failed: ${reason}`;
                    await commands.execute(CommandIDs.save, { ...args, undo: false });
                    throw new Error.Plugin(message);
                }
                await commands.execute(CommandIDs.save, { ...args, undo: false });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.revise, {
        isEnabled: () => {
            const rubric = open(_state__rspack_import_11.workbook());
            if (!(rubric === null || rubric === void 0 ? void 0 : rubric.locked))
                return false;
            const { certification, keys, seal, submission } = rubric.assignment;
            return !!seal && !!submission
                && !certification && !!keys.private.assignee;
        },
        isVisible: () => commands.isEnabled(CommandIDs.revise),
        label: trans.__('Revise submission...'),
        execute: async (args) => {
            const { rubric, workbook } = await reify(args);
            if (!(rubric === null || rubric === void 0 ? void 0 : rubric.locked))
                return;
            const passphrase = await _input__rspack_import_10.text({
                title: trans.__('Enter your submission passphrase'),
                label: trans.__('Enter the passphrase you used when submitting')
            });
            if (!passphrase)
                return;
            try {
                const secret = await _security__rspack_import_12.keygen(passphrase, rubric.id);
                const armored = await _security__rspack_import_12.decrypt(rubric.assignment.keys.private.assignee, secret);
                await revise(workbook, await _security__rspack_import_12.parse(armored));
                await commands.execute(CommandIDs.save, { ...args, undo: false });
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
        }
    }));
    disposables.push(commands.addCommand(CommandIDs.unlock, {
        icon: Icons.unlocked,
        isEnabled: () => {
            const workbook = _state__rspack_import_11.workbook();
            const rubric = open(workbook);
            return !!(headed(workbook) && rubric && rubric.locked);
        },
        isVisible: () => commands.isEnabled(CommandIDs.unlock),
        label: trans.__('Unlock'),
        usage: `
The command execute args type is \`Partial<Workbook.Credentials>\`

If no passphrase or key is provided, the command invokes a user prompt dialog.
The returned promise never rejects. The command invokes an error message dialog
if unlock fails. It returns a promise that resolves to either null or if
successful, an unlocked rubric.
    `,
        execute: async (args) => {
            const { handle, workbook } = await reify(args);
            if (!workbook)
                return null;
            try {
                return await unlocker.unlock(workbook, handle);
            }
            catch (error) {
                (0,_jupyterlab_apputils__rspack_import_0.showErrorMessage)(...Error.interpret(error, trans));
            }
            return null;
        }
    }));
    disposables.push(factory);
    return disposables;
}
async function* translate(emitter, trans) {
    const translate = (emission) => {
        const { slots, type } = emission;
        return ({
            '': slots.join(' '),
            'assigned': trans.__('Assigned to %1', ...slots),
            'create-error': trans.__('Create ERROR %1', ...slots),
            'distributed': trans.__('Distributed %1', slots[0]),
            'distribute-error': trans.__('Distribute ERROR %1 (%3)', ...slots),
            'encrypted': trans.__('Encrypted cell %1', ...slots),
            'error': trans.__('ERROR %1', ...slots),
            'mkdir': trans.__('Created directory %1', ...slots),
            'progress': trans.__('%1 of %2', ...slots),
            'retried': trans.__('Finished retrying %1', ...slots),
            'saved': trans.__('Saved %1', ...slots),
            'separator': '------------',
            'skipped': trans.__('Skipped %1', slots[0]),
            'success': trans.__('Finished! (roster: %1)', ...slots)
        })[type] || '';
    };
    for await (const emission of emitter) {
        const message = emission && translate(emission);
        if (message)
            yield [message, emission];
    }
}


},
"./lib/correxit/correxit.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Correxit: () => (Correxit)
});
/* import */ var _lumino_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@lumino/coreutils");
/* import */ var _lumino_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_lumino_coreutils__rspack_import_0);
/* import */ var _commands__rspack_import_1 = __webpack_require__("./lib/correxit/commands.js");
/* import */ var _description__rspack_import_2 = __webpack_require__("./lib/correxit/description.js");
/* import */ var _error__rspack_import_3 = __webpack_require__("./lib/correxit/error.js");
/* import */ var _icons__rspack_import_4 = __webpack_require__("./lib/correxit/icons.js");





/** Tokens and contracts for composing Correxit JupyterLab plugins. */
var Correxit;
(function (Correxit) {
    Correxit.COLLECTOR = 'correxit:collector';
    Correxit.Collector = new _lumino_coreutils__rspack_import_0.Token(Correxit.COLLECTOR);
    Correxit.CommandIDs = _commands__rspack_import_1.CommandIDs;
    Correxit.commands = _commands__rspack_import_1.commands;
    Correxit.DISTRIBUTOR = 'correxit:distributor';
    Correxit.Distributor = new _lumino_coreutils__rspack_import_0.Token(Correxit.DISTRIBUTOR);
    Correxit.CORRECTOR = 'correxit:corrector';
    Correxit.DESCRIPTION = {
        COLLECTOR: _description__rspack_import_2.COLLECTOR,
        DISTRIBUTOR: _description__rspack_import_2.DISTRIBUTOR,
        CORRECTOR: _description__rspack_import_2.CORRECTOR,
        MONITOR: _description__rspack_import_2.MONITOR,
        REGISTRAR: _description__rspack_import_2.REGISTRAR,
        SUBMITTER: _description__rspack_import_2.SUBMITTER,
        UI: _description__rspack_import_2.UI,
        UNLOCKER: _description__rspack_import_2.UNLOCKER
    };
    let Error;
    (function (Error) {
        Error.Decrypt = _error__rspack_import_3.Decrypt;
        Error.Encrypt = _error__rspack_import_3.Encrypt;
        Error.Seal = _error__rspack_import_3.Seal;
        Error.Unseal = _error__rspack_import_3.Unseal;
        Error.Mismatch = _error__rspack_import_3.Mismatch;
        Error.Invalid = _error__rspack_import_3.Invalid;
        Error.Certify = _error__rspack_import_3.Certify;
        Error.Lock = _error__rspack_import_3.Lock;
        Error.Submit = _error__rspack_import_3.Submit;
        Error.Revise = _error__rspack_import_3.Revise;
        Error.Unlock = _error__rspack_import_3.Unlock;
        Error.Save = _error__rspack_import_3.Save;
        Error.Fetch = _error__rspack_import_3.Fetch;
        Error.Plugin = _error__rspack_import_3.Plugin;
        Error.interpret = _error__rspack_import_3.interpret;
        Error.reason = _error__rspack_import_3.reason;
    })(Error = Correxit.Error || (Correxit.Error = {}));
    Correxit.GALATA = 'correxit:galata';
    Correxit.Icons = _icons__rspack_import_4.Icons;
    Correxit.MONITOR = 'correxit:monitor';
    Correxit.Monitor = new _lumino_coreutils__rspack_import_0.Token(Correxit.MONITOR);
    Correxit.NO_CORREXIT_METADATA = new TypeError('no correxit metadata');
    Correxit.REGISTRAR = 'correxit:registrar';
    Correxit.Registrar = new _lumino_coreutils__rspack_import_0.Token(Correxit.REGISTRAR);
    Correxit.SUBMITTER = 'correxit:submitter';
    Correxit.Submitter = new _lumino_coreutils__rspack_import_0.Token(Correxit.SUBMITTER);
    Correxit.TOOLBARS = 'correxit:toolbars';
    Correxit.UI = 'correxit:ui';
    Correxit.UNLOCKER = 'correxit:unlocker';
    Correxit.Unlocker = new _lumino_coreutils__rspack_import_0.Token(Correxit.UNLOCKER);
})(Correxit || (Correxit = {}));


},
"./lib/correxit/description.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  COLLECTOR: () => (COLLECTOR),
  CORRECTOR: () => (CORRECTOR),
  DISTRIBUTOR: () => (DISTRIBUTOR),
  MONITOR: () => (MONITOR),
  REGISTRAR: () => (REGISTRAR),
  SUBMITTER: () => (SUBMITTER),
  UI: () => (UI),
  UNLOCKER: () => (UNLOCKER)
});
const COLLECTOR = 'A collector of certified workbook grades';
const DISTRIBUTOR = 'A distributor of propagated Correxit workbooks';
const CORRECTOR = 'Correxit Corrector UI for batch grading workbooks';
const MONITOR = 'Correxit monitor connects active workbooks and yields them';
const REGISTRAR = 'Correxit registrar for workbook assignment registrations';
const SUBMITTER = 'Correxit submitter to receive workbook submissions';
const UI = 'Correxit workbook annotations, sidebar, and toolbar buttons';
const UNLOCKER = 'Correxit workbook key management';


},
"./lib/correxit/dispatcher.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  dispatch: () => (dispatch)
});
/* import */ var _jupyterlab_settingregistry__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/settingregistry");
/* import */ var _jupyterlab_settingregistry__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_settingregistry__rspack_import_0);
/* import */ var jupyter_secrets_manager__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/jupyter-secrets-manager/jupyter-secrets-manager");
/* import */ var jupyter_secrets_manager__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(jupyter_secrets_manager__rspack_import_1);


function dispatch(id, description, provides, create) {
    return jupyter_secrets_manager__rspack_import_1.SecretsManager.sign(id, token => {
        let deactivator = () => { };
        const state = { active: 'manual', secret: '', url: '' };
        const provision = {
            moodle: () => ({ token: state.secret, url: state.url }),
            provider: () => state.active
        };
        return {
            id,
            description,
            autoStart: true,
            requires: [jupyter_secrets_manager__rspack_import_1.ISecretsManager],
            optional: [_jupyterlab_settingregistry__rspack_import_0.ISettingRegistry],
            provides,
            activate: async (app, secrets, registry) => {
                const [plugin, deactivate] = create(app, provision);
                if (token && registry) {
                    try {
                        const stored = await secrets.get(token, id, 'moodle-token');
                        if (stored === null || stored === void 0 ? void 0 : stored.value)
                            state.secret = stored.value;
                        const subscriber = { id, secrets, state, token };
                        const unsubscribe = await subscribe({ registry, ...subscriber });
                        deactivator = () => {
                            unsubscribe();
                            deactivate();
                        };
                    }
                    catch (reason) {
                        console.warn(id, 'settings error', reason);
                        deactivator = deactivate;
                    }
                }
                else {
                    if (!token)
                        console.warn(id, 'Secrets manager token unavailable');
                    deactivator = deactivate;
                }
                return plugin;
            },
            deactivate: () => deactivator()
        };
    });
}
function anonymize({ id, secrets, state, token }) {
    let pending = Promise.resolve();
    return plugin => {
        var _a, _b;
        const user = plugin.data.user;
        const found = (_a = user === null || user === void 0 ? void 0 : user.moodle) === null || _a === void 0 ? void 0 : _a.token;
        if (found) {
            state.secret = found;
            delete user.moodle.token;
            plugin.raw = JSON.stringify(user);
            pending = pending.then(() => secrets.set(token, id, 'moodle-token', {
                namespace: id, id: 'moodle-token', value: found
            }).catch(reason => console.warn(id, 'secret set failed', reason)));
        }
        if (plugin.data.composite) {
            const composite = plugin.data.composite;
            composite.moodle = { ...((_b = composite.moodle) !== null && _b !== void 0 ? _b : {}), token: state.secret };
        }
        return plugin;
    };
}
async function subscribe({ id, registry, secrets, state, token }) {
    registry.transform(id, {
        compose: anonymize({ id, secrets, state, token })
    });
    const loaded = await registry.load(id);
    const reconfigure = () => {
        var _a;
        const composite = loaded.composite;
        state.active = composite.provider;
        state.url = composite.moodle.url;
        state.secret = (_a = composite.moodle.token) !== null && _a !== void 0 ? _a : '';
    };
    loaded.changed.connect(reconfigure);
    reconfigure();
    return () => loaded.changed.disconnect(reconfigure);
}


},
"./lib/correxit/distributors.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  manual: () => (manual)
});
/** Manual distribution is a no-op. */
async function manual(_propagated) { return true; }


},
"./lib/correxit/error.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Certify: () => (Certify),
  Decrypt: () => (Decrypt),
  Encrypt: () => (Encrypt),
  Fetch: () => (Fetch),
  Invalid: () => (Invalid),
  Lock: () => (Lock),
  Mismatch: () => (Mismatch),
  Plugin: () => (Plugin),
  Revise: () => (Revise),
  Save: () => (Save),
  Seal: () => (Seal),
  Submit: () => (Submit),
  Unlock: () => (Unlock),
  Unseal: () => (Unseal),
  interpret: () => (interpret),
  reason: () => (reason)
});
// Crypto layer
class Decrypt extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Decrypt';
    }
}
class Encrypt extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Encrypt';
    }
}
class Seal extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Seal';
    }
}
class Unseal extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Unseal';
    }
}
// Integrity layer
class Mismatch extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Mismatch';
    }
}
class Invalid extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Invalid';
    }
}
// Lifecycle layer
class Certify extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Certify';
    }
}
class Lock extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Lock';
    }
}
class Submit extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Submit';
    }
}
class Revise extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Revise';
    }
}
class Unlock extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Unlock';
    }
}
// IO layer (plugins, filesystem, network)
class Save extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Save';
    }
}
class Fetch extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Fetch';
    }
}
class Plugin extends Error {
    constructor() {
        super(...arguments);
        this.name = 'Plugin';
    }
}
/** Translate an error into a localized [title, body] pair. */
function interpret(error, trans) {
    const body = error instanceof Error ? error : new Error(String(error));
    switch (body.name) {
        case 'Decrypt': return [trans.__('Decryption failed'), body];
        case 'Encrypt': return [trans.__('Encryption failed'), body];
        case 'Seal': return [trans.__('Could not seal'), body];
        case 'Unseal': return [trans.__('Could not unseal'), body];
        case 'Mismatch': return [trans.__('Integrity mismatch'), body];
        case 'Invalid': return [trans.__('Invalid workbook'), body];
        case 'Certify': return [trans.__('Could not certify'), body];
        case 'Lock': return [trans.__('Could not lock'), body];
        case 'Submit': return [trans.__('Could not submit'), body];
        case 'Revise': return [trans.__('Could not revise'), body];
        case 'Unlock': return [trans.__('Could not unlock'), body];
        case 'Save': return [trans.__('Could not save'), body];
        case 'Fetch': return [trans.__('Could not fetch'), body];
        case 'Plugin': return [trans.__('Plugin error'), body];
        default: return [trans.__('Unexpected error'), body];
    }
}
/** @returns a string representation of a given error object. */
function reason(error) {
    return error instanceof globalThis.Error ? error.message : String(error);
}


},
"./lib/correxit/icons.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Icons: () => (Icons)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var _style_brand_correxit_mark_jupyter_svg__rspack_import_7 = __webpack_require__("./style/brand/correxit-mark-jupyter.svg");
/* import */ var _style_monitor_icons_answerable_svg__rspack_import_1 = __webpack_require__("./style/monitor/icons/answerable.svg?4f5b");
/* import */ var _style_monitor_icons_assignee_svg__rspack_import_2 = __webpack_require__("./style/monitor/icons/assignee.svg");
/* import */ var _style_monitor_icons_assignment_svg__rspack_import_3 = __webpack_require__("./style/monitor/icons/assignment.svg");
/* import */ var _style_monitor_icons_certify_svg__rspack_import_4 = __webpack_require__("./style/monitor/icons/certify.svg");
/* import */ var _style_monitor_icons_comment_svg__rspack_import_5 = __webpack_require__("./style/monitor/icons/comment.svg");
/* import */ var _style_monitor_icons_comparable_svg__rspack_import_6 = __webpack_require__("./style/monitor/icons/comparable.svg?7fe7");
/* import */ var _style_monitor_icons_convert_svg__rspack_import_8 = __webpack_require__("./style/monitor/icons/convert.svg");
/* import */ var _style_monitor_icons_correct_svg__rspack_import_9 = __webpack_require__("./style/monitor/icons/correct.svg");
/* import */ var _style_monitor_icons_correctable_svg__rspack_import_10 = __webpack_require__("./style/monitor/icons/correctable.svg?4f33");
/* import */ var _style_monitor_icons_kernel_svg__rspack_import_11 = __webpack_require__("./style/monitor/icons/kernel.svg");
/* import */ var _style_monitor_icons_key_svg__rspack_import_12 = __webpack_require__("./style/monitor/icons/key.svg");
/* import */ var _style_monitor_icons_locked_svg__rspack_import_13 = __webpack_require__("./style/monitor/icons/locked.svg?3194");
/* import */ var _style_monitor_icons_remove_svg__rspack_import_14 = __webpack_require__("./style/monitor/icons/remove.svg");
/* import */ var _style_monitor_icons_reviewable_svg__rspack_import_15 = __webpack_require__("./style/monitor/icons/reviewable.svg?5136");
/* import */ var _style_monitor_icons_roster_svg__rspack_import_16 = __webpack_require__("./style/monitor/icons/roster.svg");
/* import */ var _style_monitor_icons_secret_svg__rspack_import_17 = __webpack_require__("./style/monitor/icons/secret.svg");
/* import */ var _style_monitor_icons_shared_svg__rspack_import_18 = __webpack_require__("./style/monitor/icons/shared.svg");
/* import */ var _style_monitor_icons_template_svg__rspack_import_19 = __webpack_require__("./style/monitor/icons/template.svg");
/* import */ var _style_monitor_icons_unlocked_svg__rspack_import_20 = __webpack_require__("./style/monitor/icons/unlocked.svg");





















var Icons;
(function (Icons) {
    Icons.answerable = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:answerable', svgstr: _style_monitor_icons_answerable_svg__rspack_import_1 });
    Icons.assignee = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:assignee', svgstr: _style_monitor_icons_assignee_svg__rspack_import_2 });
    Icons.assignment = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:assignment', svgstr: _style_monitor_icons_assignment_svg__rspack_import_3 });
    Icons.certify = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:certify', svgstr: _style_monitor_icons_certify_svg__rspack_import_4 });
    Icons.comment = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:comment', svgstr: _style_monitor_icons_comment_svg__rspack_import_5 });
    Icons.comparable = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:comparable', svgstr: _style_monitor_icons_comparable_svg__rspack_import_6 });
    Icons.correxit = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:correxit', svgstr: _style_brand_correxit_mark_jupyter_svg__rspack_import_7 });
    Icons.convert = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:convert', svgstr: _style_monitor_icons_convert_svg__rspack_import_8 });
    Icons.correct = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:correct', svgstr: _style_monitor_icons_correct_svg__rspack_import_9 });
    Icons.correctable = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:correctable', svgstr: _style_monitor_icons_correctable_svg__rspack_import_10 });
    Icons.csv = _jupyterlab_ui_components__rspack_import_0.spreadsheetIcon;
    Icons.folder = _jupyterlab_ui_components__rspack_import_0.folderIcon;
    Icons.kernel = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:kernel', svgstr: _style_monitor_icons_kernel_svg__rspack_import_11 });
    Icons.key = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:key', svgstr: _style_monitor_icons_key_svg__rspack_import_12 });
    Icons.locked = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:locked', svgstr: _style_monitor_icons_locked_svg__rspack_import_13 });
    Icons.refer = _jupyterlab_ui_components__rspack_import_0.addIcon;
    Icons.remove = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:remove', svgstr: _style_monitor_icons_remove_svg__rspack_import_14 });
    Icons.reset = _jupyterlab_ui_components__rspack_import_0.notebookIcon;
    Icons.reviewable = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:reviewable', svgstr: _style_monitor_icons_reviewable_svg__rspack_import_15 });
    Icons.roster = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:roster', svgstr: _style_monitor_icons_roster_svg__rspack_import_16 });
    Icons.save = _jupyterlab_ui_components__rspack_import_0.saveIcon;
    Icons.secret = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:secret', svgstr: _style_monitor_icons_secret_svg__rspack_import_17 });
    Icons.shared = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:shared', svgstr: _style_monitor_icons_shared_svg__rspack_import_18 });
    Icons.template = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:template', svgstr: _style_monitor_icons_template_svg__rspack_import_19 });
    Icons.unlocked = new _jupyterlab_ui_components__rspack_import_0.LabIcon({ name: 'correxit:unlocked', svgstr: _style_monitor_icons_unlocked_svg__rspack_import_20 });
})(Icons || (Icons = {}));


},
"./lib/correxit/input.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  cell: () => (cell),
  text: () => (text)
});
/* import */ var _jupyterlab_apputils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/apputils");
/* import */ var _jupyterlab_apputils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__rspack_import_0);
/* import */ var _lumino_coreutils__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@lumino/coreutils");
/* import */ var _lumino_coreutils__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_lumino_coreutils__rspack_import_1);
/* import */ var _lumino_polling__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@lumino/polling");
/* import */ var _lumino_polling__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_lumino_polling__rspack_import_2);



const EXCLUDE = 'cxt-mod-exclude';
const INCLUDE = 'cxt-mod-include';
const OVERLAY = 'correxit-overlay';
const PANEL = 'correxit-chooser';
const TARGET_CELL = 'correxit-target-cell';
/** @returns a user input cell or `null`. */
function cell(workbook, options) {
    const notebook = workbook.content;
    const cells = [...notebook.widgets];
    const blocked = new Set(options.blocked);
    const usable = (cell) => {
        return !!cell && cell.model.type === 'code' && !blocked.has(cell.model.id);
    };
    const selectable = cells.filter(usable);
    const first = selectable[0] || null;
    const last = selectable.at(-1) || null;
    const delegate = new _lumino_coreutils__rspack_import_1.PromiseDelegate();
    const restore = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overlay = document.createElement('div');
    const panel = document.createElement('div');
    const heading = document.createElement('h2');
    const prompt = document.createElement('p');
    const status = document.createElement('p');
    overlay.classList.add(OVERLAY, 'cxt-mod-choose');
    overlay.setAttribute('aria-describedby', `${PANEL}-prompt ${PANEL}-status`);
    overlay.setAttribute('aria-labelledby', `${PANEL}-title`);
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    panel.className = PANEL;
    panel.tabIndex = -1;
    heading.className = `${PANEL}-title`;
    heading.id = `${PANEL}-title`;
    heading.textContent = options.title;
    prompt.className = `${PANEL}-prompt`;
    prompt.id = `${PANEL}-prompt`;
    prompt.textContent = options.prompt;
    status.className = `${PANEL}-status`;
    status.id = `${PANEL}-status`;
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('role', 'status');
    panel.append(heading, prompt, status);
    overlay.appendChild(panel);
    let target = null;
    const claim = () => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && !panel.contains(active))
            active.blur();
        panel.focus({ preventScroll: true });
    };
    const clear = (cell) => {
        cell === null || cell === void 0 ? void 0 : cell.removeClass(TARGET_CELL);
        cell === null || cell === void 0 ? void 0 : cell.removeClass(EXCLUDE);
        cell === null || cell === void 0 ? void 0 : cell.removeClass(INCLUDE);
    };
    const set = (cell) => {
        if (cell === target)
            return;
        clear(target);
        target = cell;
        if (!cell) {
            status.dataset.state = selectable.length ? 'invalid' : 'empty';
            status.textContent = options.empty;
            return;
        }
        const index = cells.indexOf(cell) + 1;
        const valid = usable(cell);
        cell.addClass(TARGET_CELL);
        cell.addClass(valid ? INCLUDE : EXCLUDE);
        status.dataset.state = valid ? 'valid' : 'invalid';
        status.textContent = options.message({ id: cell.model.id, index, valid });
    };
    const pick = (clientX, clientY) => {
        for (const cell of cells) {
            if (!cell.inViewport)
                continue;
            const rect = cell.node.getBoundingClientRect();
            if (clientY >= rect.y &&
                clientY <= rect.y + rect.height &&
                clientX >= rect.x &&
                clientX <= rect.x + rect.width)
                return cell;
        }
        return null;
    };
    const move = (step) => {
        if (!selectable.length)
            return null;
        const current = target
            ? cells.indexOf(target)
            : cells.findIndex(({ model }) => model.id === options.id);
        for (let index = current + step; index >= 0 && index < cells.length; index += step) {
            const cell = cells[index];
            if (usable(cell))
                return cell;
        }
        if (usable(target))
            return target;
        return step > 0 ? last : first;
    };
    const start = () => {
        if (!selectable.length)
            return null;
        const current = cells.findIndex(({ model }) => model.id === options.id);
        for (let index = current + 1; index < cells.length; ++index) {
            const cell = cells[index];
            if (usable(cell))
                return cell;
        }
        for (let index = 0; index < current; ++index) {
            const cell = cells[index];
            if (usable(cell))
                return cell;
        }
        return first;
    };
    const reveal = async (cell) => {
        if (cell)
            await notebook.scrollToCell(cell);
        requestAnimationFrame(claim);
    };
    const close = (model) => {
        var _a;
        clear(target);
        overlay.removeEventListener('click', click);
        document.removeEventListener('pointermove', pointermove, true);
        document.removeEventListener('keydown', keydown, true);
        overlay.remove();
        target = null;
        throttler.dispose();
        if (restore === null || restore === void 0 ? void 0 : restore.isConnected)
            restore.focus();
        else
            (_a = notebook.activeCell) === null || _a === void 0 ? void 0 : _a.node.focus();
        delegate.resolve(model);
    };
    const keydown = (event) => {
        const { key } = event;
        if (key === 'Tab') {
            event.preventDefault();
            claim();
            return;
        }
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(null);
            return;
        }
        if (key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (usable(target))
                close(target.model);
            return;
        }
        const cell = key === 'ArrowDown'
            ? move(1)
            : key === 'ArrowUp'
                ? move(-1)
                : key === 'Home'
                    ? first
                    : key === 'End'
                        ? last
                        : null;
        if (!cell)
            return;
        event.preventDefault();
        event.stopPropagation();
        set(cell);
        void reveal(cell);
    };
    const click = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cell = pick(event.clientX, event.clientY);
        set(cell);
        if (usable(cell))
            close(cell.model);
    };
    const throttler = new _lumino_polling__rspack_import_2.Throttler(({ clientX, clientY }) => {
        const cell = pick(clientX, clientY);
        set(cell);
    }, { limit: 100 });
    const pointermove = (event) => {
        event.preventDefault();
        void throttler.invoke(event);
    };
    notebook.viewportNode.appendChild(overlay);
    set(start());
    document.addEventListener('pointermove', pointermove, true);
    overlay.addEventListener('click', click);
    document.addEventListener('keydown', keydown, true);
    void reveal(target);
    return delegate.promise;
}
/** @returns text input from the user. */
const text = async (options) => {
    const { button, value } = await _jupyterlab_apputils__rspack_import_0.InputDialog.getText(options);
    return button.accept && value || '';
};


},
"./lib/correxit/io.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  available: () => (available),
  cd: () => (cd),
  create: () => (create),
  load: () => (load),
  mkdir: () => (mkdir),
  notebooks: () => (notebooks),
  request: () => (request),
  resources: () => (resources),
  stage: () => (stage),
  write: () => (write)
});
/* import */ var _jupyterlab_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_0);
/* import */ var _jupyterlab_docregistry__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/docregistry");
/* import */ var _jupyterlab_docregistry__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_docregistry__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/workbook.js");



const racks = new Map();
const home = '';
const scratch = 'correxit-corrector';
const claim = async (root, capacity) => {
    const kept = rack(root);
    const limit = Math.max(1, capacity);
    let position = vacant(kept, limit);
    while (position < 0 && kept.count >= limit) {
        await new Promise(resolve => kept.waiters.push(resolve));
        position = vacant(kept, limit);
    }
    const index = position >= 0 ? kept.free.splice(position, 1)[0] : kept.count++;
    let released = false;
    kept.used.add(index);
    return {
        index,
        release: async () => {
            var _a;
            if (released)
                return;
            released = true;
            if (!kept.used.delete(index))
                return;
            kept.free.push(index);
            (_a = kept.waiters.shift()) === null || _a === void 0 ? void 0 : _a();
        }
    };
};
const clear = async ({ contents }, path) => {
    const slot = await contents.get(path, { content: true });
    const entries = slot.content || [];
    await Promise.all(entries.map(({ path }) => contents.delete(path)));
};
const directory = async (manager, pwd, path) => {
    try {
        await manager.contents.get(path, { content: false });
    }
    catch (_a) {
        await mkdir(manager, pwd, path);
    }
};
const encode = (data) => {
    let binary = '';
    for (let i = 0; i < data.length; i += 8192)
        binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return btoa(binary);
};
const mount = async (manager, dir, root, index) => {
    const kept = rack(root);
    if (!kept.root) {
        const rooted = directory(manager, dir, root);
        kept.root = rooted;
        void rooted.catch(() => {
            if (kept.root === rooted)
                kept.root = null;
        });
    }
    let ready = kept.ready.get(index);
    if (!ready) {
        const path = _jupyterlab_coreutils__rspack_import_0.PathExt.join(root, `slot-${index + 1}`);
        ready = kept.root.then(() => directory(manager, root, path));
        kept.ready.set(index, ready);
        void ready.catch(() => {
            if (kept.ready.get(index) === ready)
                kept.ready.delete(index);
        });
    }
    await ready;
};
const rack = (root) => {
    if (!racks.has(root)) {
        racks.set(root, {
            count: 0,
            free: [],
            ready: new Map(),
            root: null,
            used: new Set(),
            waiters: []
        });
    }
    return racks.get(root);
};
const sidecar = (dir, name) => {
    if (!name || name === '.' || name === '..' || _jupyterlab_coreutils__rspack_import_0.PathExt.basename(name) !== name)
        throw new ___rspack_import_2.Correxit.Error.Fetch(`Invalid resource name: ${name}`);
    return _jupyterlab_coreutils__rspack_import_0.PathExt.join(dir, name);
};
const vacant = (kept, limit) => {
    for (let position = kept.free.length - 1; position >= 0; position--)
        if (kept.free[position] < limit)
            return position;
    return -1;
};
/** @returns an available path in pwd for the given seed name. */
async function available({ contents }, pwd, seed, ext = '') {
    const response = await contents.get(pwd, { content: true });
    if (response.type !== 'directory')
        throw new ___rspack_import_2.Correxit.Error.Fetch(`Not a directory: ${pwd}`);
    const paths = response.content.map(({ path }) => path);
    const parent = new Set(paths);
    for (let suffix = 0;; suffix++) {
        const file = suffix ? `${seed}-${suffix}${ext}` : `${seed}${ext}`;
        const path = _jupyterlab_coreutils__rspack_import_0.PathExt.join(pwd, file);
        if (!parent.has(path))
            return path;
    }
}
/** Navigates the file browser to path. */
async function cd(commands, path) {
    const command = 'filebrowser:go-to-path';
    if (commands.hasCommand(command))
        commands.execute(command, { path });
}
/** @returns a headless workbook or null. */
async function create(options) {
    const { notebook, factory, manager, manager: { contents } } = options;
    const ext = '.ipynb';
    const path = _jupyterlab_coreutils__rspack_import_0.PathExt.dirname(options.path);
    const type = 'notebook';
    try {
        const untitled = await contents.newUntitled({ ext, path, type });
        const renamed = await contents.rename(untitled.path, options.path);
        const context = new _jupyterlab_docregistry__rspack_import_1.Context({ factory, manager, path: renamed.path });
        try {
            await context.initialize(true);
            await context.ready;
            context.model.sharedModel.fromJSON(notebook);
            await context.save();
            return true;
        }
        finally {
            context.dispose();
        }
    }
    catch (error) {
        console.warn('create error', error);
        return false;
    }
}
/** @returns the raw bytes of a co-located resource file. */
async function load({ contents }, dir, name) {
    const path = sidecar(dir, name);
    try {
        const file = await contents.get(path, { format: 'base64', content: true });
        const binary = atob(file.content);
        return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    catch (_a) {
        throw new ___rspack_import_2.Correxit.Error.Fetch(`Could not load resource file: ${path}`);
    }
}
/** Creates a directory at path inside pwd. */
async function mkdir({ contents }, pwd, path) {
    const untitled = await contents.newUntitled({ path: pwd, type: 'directory' });
    return await contents.rename(untitled.path, path);
}
/** @returns notebooks in a directory sorted lexically by name. */
async function notebooks({ contents }, path) {
    const response = await contents.get(path, { content: true });
    if (response.type !== 'directory')
        throw new ___rspack_import_2.Correxit.Error.Fetch(`Not a directory: ${path}`);
    const notebook = ({ type }) => type === 'notebook';
    const lexical = (a, b) => a.name.localeCompare(b.name);
    return (response.content || []).filter(notebook).sort(lexical);
}
/** @returns a headless workbook, optionally unlocked, or null. */
async function request(handle, factory, manager, unlocker, silent = false) {
    const { key, passphrase, path, unlock } = handle;
    const context = new _jupyterlab_docregistry__rspack_import_1.Context({ manager, factory, path });
    const workbook = { content: null, context };
    await context.initialize(false);
    const rubric = ___rspack_import_3.Workbook.open(workbook, true);
    const unauthenticated = !(key || passphrase || unlock);
    if (!rubric) {
        context.dispose();
        return null;
    }
    if (!rubric.locked || unlock === false || unauthenticated) {
        await ___rspack_import_3.Workbook.lock(workbook);
        return workbook;
    }
    try {
        await unlocker.unlock(workbook, silent ? { ...handle, silent } : handle);
    }
    catch (error) {
        console.warn(`access error, ${path}`, error);
    }
    return workbook;
}
/** @returns non-notebook files in a directory sorted lexically by name. */
async function resources({ contents }, path) {
    const response = await contents.get(path, { content: true });
    if (response.type !== 'directory')
        throw new ___rspack_import_2.Correxit.Error.Fetch(`Not a directory: ${path}`);
    const resource = ({ type }) => type === 'file';
    const lexical = (a, b) => a.name.localeCompare(b.name);
    return (response.content || []).filter(resource).sort(lexical);
}
/**
 * Stage a workbook for isolated execution.
 *
 * Creates or reuses top-level `correxit-corrector/slot-N/`, clears any files
 * left by a prior occupant, saves the notebook there, and copies each sidecar
 * file from `dir` into the same slot.
 *
 * @returns the path of the staged notebook.
 */
async function stage({ capacity, dir, manager, notebook, resources }) {
    const { contents } = manager;
    const root = scratch;
    const slot = await claim(root, capacity);
    const subdirectory = _jupyterlab_coreutils__rspack_import_0.PathExt.join(root, `slot-${slot.index + 1}`);
    const staged = _jupyterlab_coreutils__rspack_import_0.PathExt.join(subdirectory, 'workbook.ipynb');
    try {
        await mount(manager, home, root, slot.index);
        await clear(manager, subdirectory);
        await Promise.all([
            contents.save(staged, {
                type: 'notebook',
                format: 'json',
                content: notebook
            }),
            ...(resources !== null && resources !== void 0 ? resources : []).map(name => contents.copy(sidecar(dir, name), subdirectory))
        ]);
        return { path: staged, release: slot.release };
    }
    catch (error) {
        await slot.release();
        throw error;
    }
}
/** Writes raw bytes to a file path. */
async function write({ contents }, path, data) {
    await contents.save(path, {
        content: encode(data),
        format: 'base64',
        type: 'file'
    });
}


},
"./lib/correxit/kernels.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  cap: () => (cap),
  configure: () => (configure),
  drain: () => (drain),
  lease: () => (lease),
  retries: () => (retries),
  snapshot: () => (snapshot),
  timeout: () => (timeout)
});
/* import */ var _jupyterlab_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_0);
/* import */ var _lumino_coreutils__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@lumino/coreutils");
/* import */ var _lumino_coreutils__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_lumino_coreutils__rspack_import_1);


/** Time-to-live for idle kernel caching (ms). */
const TTL = 5000;
const pool = new Map();
const waiters = [];
const defaults = {
    concurrency: 3,
    retries: 2,
    timeout: 60
};
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
let configuration = { ...defaults };
let active = 0;
let cached = 0;
let epoch = 0;
let order = 0;
let recycling = 0;
/** Updates pool configuration and wakes any newly-eligible waiters. */
function configure({ concurrency, retries, timeout }) {
    configuration = {
        concurrency: Math.max(1, finite(concurrency, defaults.concurrency)),
        retries: Math.max(0, finite(retries, defaults.retries)),
        timeout: Math.max(0, finite(timeout, defaults.timeout))
    };
    trim();
    while (busy() < configuration.concurrency && waiters.length)
        wake();
}
/** @returns the current concurrency cap. */
function cap() {
    return configuration.concurrency;
}
/** @returns the configured retry count. */
function retries() {
    return configuration.retries;
}
/** @returns the lease deadline in milliseconds (0 = no deadline). */
function timeout() {
    return configuration.timeout * 1000;
}
/** @internal Returns pool counters for integration tests. */
function snapshot() {
    return {
        active,
        cached,
        concurrency: configuration.concurrency,
        recycling,
        waiting: waiters.length
    };
}
/** @internal Resets all module state for tests. */
function drain() {
    epoch++;
    for (const entries of pool.values()) {
        for (const { timer, session } of entries) {
            clearTimeout(timer);
            void dispose(session);
        }
    }
    pool.clear();
    active = 0;
    cached = 0;
    configuration = { ...defaults };
    order = 0;
    recycling = 0;
    waiters.length = 0;
}
/**
 * Lease a kernel for a workbook. Returns `[kernel, release]` or `null`.
 *
 * Released kernels are restarted and returned to the pool; failed restarts
 * are disposed. When `timeout > 0`, a deadline reclaims zombie leases by
 * interrupting the kernel and freeing the semaphore slot.
 */
async function lease(workbook) {
    const mark = epoch;
    await acquire();
    const runtime = await locate(workbook);
    const idle = take(runtime);
    const ready = revive(idle);
    if (idle && !ready)
        void dispose(idle.session);
    const started = ready !== null && ready !== void 0 ? ready : (await start(workbook, runtime));
    if (!started) {
        relinquish();
        return null;
    }
    let released = false;
    const { kernel } = started;
    const expire = () => {
        if (released)
            return;
        released = true;
        kernel.interrupt().catch(() => { });
        void dispose(started.session);
        if (mark === epoch)
            relinquish();
    };
    const timer = configuration.timeout > 0
        ? setTimeout(expire, configuration.timeout * 1000)
        : null;
    const release = async () => {
        if (released)
            return;
        released = true;
        if (timer)
            clearTimeout(timer);
        return recycle(started, mark);
    };
    return [kernel, release];
}
/** Blocks until a slot opens, then claims it. */
async function acquire() {
    while (busy() >= configuration.concurrency)
        await new Promise(resolve => waiters.push(resolve));
    active++;
}
/** @returns kernels that currently occupy the concurrency cap. */
function busy() {
    return active + recycling;
}
/** @returns the runtime after waiting for the document model. */
async function locate(workbook) {
    const { context } = workbook;
    await context.ready.catch(() => { });
    const name = context.model.defaultKernelName;
    const dirname = _jupyterlab_coreutils__rspack_import_0.PathExt.dirname(context.path || '');
    const cwd = dirname === '.' ? '' : dirname;
    return { cwd, key: `${name}\0${cwd}`, name };
}
/** Pops the most recently cached kernel for `runtime`. */
function take(runtime) {
    var _a;
    const entries = pool.get(runtime.key);
    const idle = (_a = entries === null || entries === void 0 ? void 0 : entries.pop()) !== null && _a !== void 0 ? _a : null;
    if (idle)
        clearTimeout(idle.timer);
    if (idle)
        cached--;
    if (entries && !entries.length)
        pool.delete(runtime.key);
    return idle;
}
/** @returns the lease if it is still usable, or `null`. */
function revive(idle) {
    return idle && !idle.kernel.isDisposed && !idle.session.isDisposed
        ? idle
        : null;
}
/** Starts a new kernel for the workbook. */
async function start(workbook, runtime) {
    const { sessionManager } = workbook.context.sessionContext;
    const { cwd, name } = runtime;
    if (!sessionManager || !name) {
        console.warn('kernels: missing session manager or kernel name');
        return null;
    }
    try {
        const uuid = _lumino_coreutils__rspack_import_1.UUID.uuid4();
        const path = _jupyterlab_coreutils__rspack_import_0.PathExt.join(cwd, uuid);
        const session = await sessionManager.startNew({
            kernel: { name },
            name: uuid,
            path,
            type: 'notebook'
        });
        const { kernel } = session;
        if (!kernel) {
            await dispose(session);
            console.warn('kernels: missing kernel after session start');
            return null;
        }
        let timer = null;
        const deadline = configuration.timeout * 1000;
        const ready = configuration.timeout > 0
            ? Promise.race([
                kernel.info,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('kernel: info timeout')), deadline);
                })
            ])
            : kernel.info;
        try {
            await ready;
        }
        catch (error) {
            await dispose(session);
            console.warn('kernels: start failed', error);
            return null;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
        return { kernel, runtime, session };
    }
    catch (error) {
        console.warn('kernels: start failed', error);
    }
    return null;
}
/** Frees one slot and wakes the next blocked caller. */
function relinquish() {
    active--;
    wake();
}
/** Restarts a kernel and returns it to the pool, or disposes on failure. */
async function recycle(started, mark) {
    if (mark !== epoch)
        return dispose(started.session);
    active--;
    recycling++;
    try {
        const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('restart timeout')), 10000));
        const kernel = await Promise.race([restart(started.kernel), deadline]);
        if (mark === epoch)
            keep({ ...started, kernel });
        else
            await dispose(started.session);
    }
    catch (_a) {
        await dispose(started.session);
    }
    finally {
        if (mark === epoch) {
            recycling--;
            wake();
        }
    }
}
/** Restarts a kernel, tolerating servers that return `201 Created`. */
async function restart(kernel) {
    try {
        await kernel.restart();
        await kernel.requestKernelInfo();
        return kernel;
    }
    catch (error) {
        if (status(error) !== 201)
            throw error;
        const fresh = kernel.clone();
        // Dispose only the stale client connection. The restarted kernel lives on.
        kernel.dispose();
        try {
            await fresh.requestKernelInfo();
            fresh.hasPendingInput = false;
            return fresh;
        }
        catch (error) {
            fresh.dispose();
            throw error;
        }
    }
}
/** @returns an HTTP status carried by a Jupyter services error. */
function status(error) {
    var _a, _b;
    if (!error || typeof error !== 'object' || !('response' in error))
        return null;
    return (_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : null;
}
/** Caches an idle kernel with TTL eviction. Evicts oldest on overflow. */
function keep(started) {
    const idle = {
        ...started,
        order: order++,
        timer: setTimeout(() => evict(idle), TTL)
    };
    const entries = shelf(started.runtime);
    entries.push(idle);
    cached++;
    trim();
}
/** @returns the idle-kernel list for `runtime`, creating it on first access. */
function shelf(runtime) {
    let entries = pool.get(runtime.key);
    if (!entries)
        pool.set(runtime.key, entries = []);
    return entries;
}
/** Keeps total idle kernels bounded as cwd values change over time. */
function trim() {
    if (cached <= configuration.concurrency)
        return;
    const excess = [...pool.values()]
        .flat()
        .sort((left, right) => left.order - right.order)
        .slice(0, cached - configuration.concurrency);
    for (const idle of excess) {
        clearTimeout(idle.timer);
        remove(idle);
        void dispose(idle.session);
    }
}
/** Removes a kernel from the pool and disposes it (TTL callback). */
function evict(idle) {
    remove(idle);
    void dispose(idle.session);
}
/** Removes an idle kernel from its shelf. */
function remove(idle) {
    const { key } = idle.runtime;
    const entries = pool.get(key);
    if (!entries)
        return;
    const remaining = entries.filter(entry => entry !== idle);
    cached -= entries.length - remaining.length;
    if (remaining.length)
        pool.set(key, remaining);
    else
        pool.delete(key);
}
/** Shuts down and disposes a session and its kernel. Idempotent. */
async function dispose(session) {
    if (!session.isDisposed)
        await session.shutdown().catch(() => { }).finally(() => session.dispose());
}
/** Wakes the next caller blocked on a pool slot. */
function wake() {
    var _a;
    (_a = waiters.shift()) === null || _a === void 0 ? void 0 : _a();
}


},
"./lib/correxit/nbgrader.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  autotests: () => (autotests),
  classify: () => (classify),
  clean: () => (clean),
  convert: () => (convert),
  detect: () => (detect),
  expand: () => (expand),
  hidden: () => (hidden),
  presplit: () => (presplit),
  report: () => (report),
  slippage: () => (slippage),
  spread: () => (spread),
  strip: () => (strip)
});
/* import */ var _kernels__rspack_import_0 = __webpack_require__("./lib/correxit/kernels.js");
/* import */ var _workbook__rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");


const AUTOTEST = /^###\s+(?:HASHED\s+)?AUTOTEST\s+(.+)$/;
const BEGIN_SOLUTION = /^#{3,}\s*BEGIN\s+SOLUTION\s*$/;
const END_SOLUTION = /^#{3,}\s*END\s+SOLUTION\s*$/;
const BEGIN_HIDDEN = /^#{3,}\s*BEGIN\s+HIDDEN\s+TESTS?\s*$/;
const END_HIDDEN = /^#{3,}\s*END\s+HIDDEN\s+TESTS?\s*$/;
const BEGIN_MARK = /^={3,}\s*BEGIN\s+MARK\s+SCHEME\s*={3,}$/;
const END_MARK = /^={3,}\s*END\s+MARK\s+SCHEME\s*={3,}$/;
const VERIFY = '__correxit_autotest__';
const VALUE = '__correxit_autotest_value__';
const support = `def ${VERIFY}(label, actual, expected):
    if actual != expected:
      raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")`;
/**
 * Returns true if at least one cell carries nbgrader metadata with
 * `grade === true`, `solution === true`, or `task === true`.
 */
function detect(cells) {
    return cells.some(cell => {
        const nbgrader = cell.metadata.nbgrader;
        return (nbgrader === null || nbgrader === void 0 ? void 0 : nbgrader.grade) === true
            || (nbgrader === null || nbgrader === void 0 ? void 0 : nbgrader.solution) === true
            || (nbgrader === null || nbgrader === void 0 ? void 0 : nbgrader.task) === true;
    });
}
/**
 * Strip solution and mark-scheme markers from cell source.
 *
 * Solution markers (`### BEGIN/END SOLUTION`): the marker lines are
 * removed but solution code between them is kept.
 *
 * Mark-scheme regions (`=== BEGIN/END MARK SCHEME ===`): everything
 * between the markers (inclusive) is dropped.
 */
function strip(source) {
    const lines = source.split('\n');
    const out = [];
    let marking = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (BEGIN_MARK.test(trimmed)) {
            marking = true;
            continue;
        }
        if (END_MARK.test(trimmed)) {
            marking = false;
            continue;
        }
        if (marking)
            continue;
        if (BEGIN_SOLUTION.test(trimmed))
            continue;
        if (END_SOLUTION.test(trimmed))
            continue;
        out.push(line);
    }
    return out.join('\n');
}
/**
 * Extract hidden test regions from a test cell source.
 *
 * Returns the visible and hidden portions, or null when no
 * hidden test markers are present.
 */
function hidden(source) {
    const lines = source.split('\n');
    const visible = [];
    const extracted = [];
    let inside = false;
    let found = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (BEGIN_HIDDEN.test(trimmed)) {
            inside = true;
            found = true;
            continue;
        }
        if (END_HIDDEN.test(trimmed)) {
            inside = false;
            continue;
        }
        if (inside)
            extracted.push(line);
        else
            visible.push(line);
    }
    if (!found)
        return null;
    return {
        visible: visible.join('\n').trimEnd(),
        hidden: extracted.join('\n')
    };
}
/**
 * Pre-split cells containing hidden test regions.
 *
 * Test cells with BEGIN HIDDEN / END HIDDEN markers become two cells:
 * the visible portion (same ID, original points) and the hidden
 * portion (synthetic ID, original points). Both halves receive the
 * same point value (clamped to >= 0), so split tests can increase
 * the converted total. This runs before classify() so that
 * classification never reasons about mid-stride splits.
 */
function presplit(cells) {
    var _a, _b;
    const expanded = [];
    const sources = [];
    const splits = [];
    for (const cell of cells) {
        const meta = cell.metadata.nbgrader;
        const test = (meta === null || meta === void 0 ? void 0 : meta.grade) === true && (meta === null || meta === void 0 ? void 0 : meta.solution) !== true
            && cell.cell_type === 'code';
        if (!test) {
            expanded.push(cell);
            continue;
        }
        const split = hidden(cell.source);
        if (!split || !split.visible.trim()) {
            expanded.push(cell);
            if (split)
                sources.push({ id: cell.id, source: split.hidden });
            continue;
        }
        const referent = `${cell.id}-hidden`;
        const points = Math.max(0, (_a = meta.points) !== null && _a !== void 0 ? _a : 1);
        // Visible portion: same ID, same points as the original.
        expanded.push({
            ...cell,
            source: split.visible,
            metadata: {
                ...cell.metadata,
                nbgrader: { ...meta, points }
            }
        });
        // Hidden portion: synthetic cell with the same points.
        expanded.push({
            id: referent,
            cell_type: 'code',
            source: split.hidden,
            metadata: {
                nbgrader: {
                    grade: true,
                    grade_id: referent,
                    locked: true,
                    points,
                    schema_version: (_b = meta.schema_version) !== null && _b !== void 0 ? _b : 3,
                    solution: false
                }
            }
        });
        sources.push({ id: cell.id, source: split.visible });
        splits.push({ cell: cell.id, referent, source: split.hidden });
    }
    return { cells: expanded, sources, splits };
}
/**
 * Scale point values to the smallest integers preserving their ratios.
 *
 * #### Notes
 * nbgrader commonly splits a cell's total across tests as fractions
 * (e.g. 0.5 + 0.5). Correxit requires integer points. This finds the
 * smallest multiplier k such that every value * k is integral.
 */
function recalibrate(values) {
    for (let scale = 1; scale <= 1000; scale++) {
        const integral = values.every(value => Math.abs(value * scale - Math.round(value * scale)) < 1e-9);
        if (integral)
            return values.map(value => Math.round(value * scale));
    }
    return values.map(value => Math.round(value * 100));
}
/**
 * Walk cells top-to-bottom and classify into rubric entries.
 *
 * Linkage: nbgrader has no explicit answer-to-test link. Tests
 * follow their answer in notebook order; intervening markdown,
 * read-only, and unmarked cells do not break the chain.
 *
 * | nbgrader         | metadata flags            | correxit    |
 * |------------------|---------------------------|-------------|
 * | Autograded answer| solution, !grade          | correctable |
 * | Autograder tests | grade, !solution, code    | reference   |
 * | Manual answer    | grade, solution           | reviewable  |
 * | Manual task      | task (or grade+md)        | reviewable  |
 * | Read-only/locked | locked, !grade, !solution | (skip)      |
 * | Unmarked         | no nbgrader key           | (skip)      |
 */
function classify(cells) {
    var _a;
    let answer = null;
    const result = {
        cells: [],
        references: [],
        sources: [],
        splits: [],
        warnings: []
    };
    const flush = () => {
        if (!answer)
            return;
        const { id, tests } = answer;
        answer = null;
        if (tests.length) {
            const scaled = recalibrate(tests.map(test => test.points));
            const points = scaled.reduce((sum, value) => sum + value, 0);
            const cell = {
                id, is: 'correctable', payload: null, points,
                references: tests.map(test => test.id)
            };
            const references = tests.map((test, i) => ({
                cell: id,
                referent: test.id,
                points: scaled[i],
                secret: true
            }));
            result.cells.push(cell);
            result.references.push(references);
        }
        else {
            const warn = `No test cells: autograded answer ${id} set to reviewable`;
            result.warnings.push(warn);
            const cell = {
                id, is: 'reviewable', payload: null,
                points: 1, references: null
            };
            result.cells.push(cell);
            result.references.push([]);
        }
    };
    // Pending task description waiting for its working cell.
    let task = null;
    for (const cell of cells) {
        const meta = cell.metadata.nbgrader;
        if (!meta || (meta.grade !== true
            && meta.solution !== true
            && meta.task !== true)) {
            // Unmarked cell. If a task is pending, this is it.
            if (task) {
                flush();
                const points = Math.round(task.points);
                task = null;
                result.cells.push({
                    id: cell.id, is: 'reviewable', payload: null,
                    points, references: null
                });
                result.references.push([]);
            }
            continue;
        }
        const is = (() => {
            const answer = meta.solution === true && meta.grade !== true;
            const manual = meta.grade === true && meta.solution === true;
            const task = meta.task === true || (meta.grade === true
                && meta.solution !== true
                && cell.cell_type === 'markdown');
            const test = meta.grade === true && meta.solution !== true
                && !task && cell.cell_type === 'code';
            return { answer, manual, task, test };
        })();
        const points = Math.max(0, (_a = meta.points) !== null && _a !== void 0 ? _a : 1);
        if (is.task) {
            flush();
            task = { points };
            continue;
        }
        if (task) {
            // Clear pending task not consumed by an unmarked cell.
            const warn = 'Task cell had no following unmarked cell; points discarded';
            result.warnings.push(warn);
            task = null;
        }
        if (is.answer) {
            flush();
            answer = { id: cell.id, tests: [] };
            const stripped = strip(cell.source);
            if (stripped !== cell.source)
                result.sources.push({ id: cell.id, source: stripped });
            continue;
        }
        if (is.test) {
            if (answer) {
                answer.tests.push({ id: cell.id, points });
            }
            else {
                const warn = `Test cell "${cell.id}" has no preceding answer; skipped`;
                result.warnings.push(warn);
            }
            continue;
        }
        if (is.manual) {
            flush();
            result.cells.push({
                id: cell.id, is: 'reviewable', payload: null,
                points: Math.round(points), references: null
            });
            result.references.push([]);
            const stripped = strip(cell.source);
            if (stripped !== cell.source)
                result.sources.push({ id: cell.id, source: stripped });
            continue;
        }
    }
    flush();
    if (task) {
        const warn = 'Trailing task cell had no following working cell; discarded';
        result.warnings.push(warn);
    }
    return result;
}
/** Returns true if the source contains autotest directives. */
function autotests(source) {
    return source.split('\n').some(line => AUTOTEST.test(line.trim()));
}
/** Remove the `nbgrader` key from a metadata object. */
function clean(metadata) {
    const { nbgrader, ...rest } = metadata;
    void nbgrader;
    return rest;
}
/**
 * Compare the sum of nbgrader metadata points to the converted rubric
 * total. Returns the original metadata total when it differs (due to
 * recalibration, rounding, or discarded cells), or null when the
 * totals agree.
 */
function slippage(cells, classification) {
    let total = 0;
    let found = false;
    for (const cell of cells) {
        const nbgrader = cell.metadata.nbgrader;
        if ((nbgrader === null || nbgrader === void 0 ? void 0 : nbgrader.points) === null || (nbgrader === null || nbgrader === void 0 ? void 0 : nbgrader.points) === undefined)
            continue;
        if (!nbgrader.grade && !nbgrader.solution && !nbgrader.task)
            continue;
        total += Math.max(0, nbgrader.points);
        found = true;
    }
    if (!found)
        return null;
    const rubric = classification.cells.reduce((sum, cell) => sum + cell.points, 0);
    return total === rubric ? null : total;
}
/** Build a summary report for a completed nbgrader conversion. */
function report(source, classification, trans) {
    const { cells, splits, warnings } = classification;
    const correctable = cells.filter(({ is }) => is === 'correctable');
    const reviewable = cells.filter(({ is }) => is === 'reviewable');
    const points = cells.reduce((sum, { points }) => sum + points, 0);
    const lines = [
        trans.__('This notebook was rewritten in place as a Correxit workbook.'),
        '',
        trans.__('%1 auto-graded, %2 manually graded, %3 total points.', correctable.length, reviewable.length, points),
        trans.__('Keep the original nbgrader notebook until you are satisfied with the conversion.')
    ];
    if (splits.length)
        lines.push(trans.__('%1 hidden test regions extracted.', splits.length));
    const original = slippage(source, classification);
    if (original !== null) {
        lines.push(trans.__('Original nbgrader total: %1 points. Converted: %2.', original, points), trans.__('Correxit scales fractional points to integers and rounds if necessary'), trans.__('Check the values in the sidebar.'));
    }
    if (warnings.length) {
        lines.push('');
        for (const warning of warnings)
            lines.push(`\u26a0 ${warning}`);
    }
    lines.push('');
    lines.push(trans.__('Expand the Correxit sidebar to inspect each cell configuration.'));
    return lines;
}
function placeholder(expr, value) {
    const note = JSON.stringify(`Correxit could not safely convert AUTOTEST: ${expr}`);
    const lines = [
        '# Correxit could not safely convert this AUTOTEST.',
        '# Review and rewrite this reference cell manually.',
        '# Original directive:',
        `# ### AUTOTEST ${expr}`
    ];
    if (value !== null) {
        lines.push('# Observed kernel value:');
        lines.push(...value.split('\n').map(line => `# ${line}`));
    }
    lines.push(`raise NotImplementedError(${note})`);
    return lines.join('\n');
}
function python(expr, value) {
    return `${VERIFY}(${JSON.stringify(expr)}, (${expr}), ${value})`;
}
/** Parse autotest directives from a cell source. */
function directives(source) {
    return source.split('\n')
        .map((raw, line) => ({ raw, line }))
        .filter(({ raw }) => AUTOTEST.test(raw.trim()))
        .map(({ raw, line }) => {
        const match = raw.trim().match(AUTOTEST);
        const expressions = match[1]
            .split(';')
            .map(expr => expr.trim())
            .filter(Boolean);
        return { line, expressions };
    });
}
function request(kernel, code) {
    return new Promise(resolve => {
        const future = kernel.requestExecute({ code }, true);
        let value = null;
        future.onIOPub = msg => {
            var _a;
            if (msg.header.msg_type === 'execute_result') {
                const data = msg.content.data;
                value = (_a = data === null || data === void 0 ? void 0 : data['text/plain']) !== null && _a !== void 0 ? _a : null;
            }
        };
        future.done
            .then(({ content }) => resolve({ ok: content.status === 'ok', value }))
            .catch(() => resolve({ ok: false, value: null }));
    });
}
/** Build an executor backed by a live kernel connection. */
function executor(kernel) {
    return async (code) => {
        const { ok, value } = await request(kernel, code);
        return ok ? value : null;
    };
}
function guess(name) {
    var _a;
    const label = (_a = name === null || name === void 0 ? void 0 : name.toLowerCase()) !== null && _a !== void 0 ? _a : null;
    if (!label)
        return null;
    return label.includes('python') ? 'python' : label;
}
async function language(kernel) {
    var _a;
    const info = await kernel.info.catch(_ => null);
    const name = guess((_a = info === null || info === void 0 ? void 0 : info.language_info) === null || _a === void 0 ? void 0 : _a.name);
    if (name)
        return name;
    const spec = await kernel.spec.catch(_ => null);
    return guess((spec === null || spec === void 0 ? void 0 : spec.language) || kernel.name);
}
function resolver(kernel, render) {
    return async (expr) => {
        const observed = await request(kernel, `${VALUE} = (${expr})\n${VALUE}`);
        if (!observed.ok || observed.value === null)
            return { safe: false, value: observed.value };
        const validated = await request(kernel, [support, render(expr, observed.value)].join('\n\n'));
        return { safe: validated.ok, value: observed.value };
    };
}
/** AUTOTEST expand() logic (separated for unit testing without a kernel). */
async function spread(cells, classification, execute, resolve, render = python) {
    var _a, _b;
    const answers = new Set(classification.cells
        .filter(({ is }) => is === 'correctable')
        .map(({ id }) => id));
    const referents = new Set(classification.references.flat().map(({ referent }) => referent));
    const stripped = new Map(classification.sources.map(({ id, source }) => [id, source]));
    const expanded = [];
    const warnings = [];
    const inspect = resolve || (async (expr) => {
        const value = await execute(expr);
        return { safe: value !== null, value };
    });
    const rewrite = async (id, source) => {
        const autotests = directives(source);
        if (!autotests.length) {
            await execute(source);
            return null;
        }
        let pending = [];
        const lines = source.split('\n');
        const on = new Set(autotests.map(({ line }) => line));
        const output = [];
        const flush = async () => {
            if (!pending.length)
                return;
            const block = pending.join('\n');
            output.push(...pending);
            pending = [];
            if (block.trim())
                await execute(block);
        };
        let prepared = false;
        for (let i = 0; i < lines.length; i++) {
            if (!on.has(i)) {
                pending.push(lines[i]);
                continue;
            }
            await flush();
            const directive = autotests.find(({ line }) => line === i);
            for (const expr of directive.expressions) {
                const { safe, value } = await inspect(expr);
                if (safe && value !== null) {
                    if (!prepared) {
                        output.push(support, '');
                        prepared = true;
                    }
                    output.push(render(expr, value));
                }
                else {
                    warnings.push(value === null
                        ? `Expansion failed for "${expr}" in cell "${id}"`
                        : `Could not safely convert AUTOTEST "${expr}" in cell "${id}"`);
                    output.push(placeholder(expr, value));
                }
            }
        }
        await flush();
        return output.join('\n');
    };
    for (const cell of cells) {
        if (answers.has(cell.id)) {
            await execute((_a = stripped.get(cell.id)) !== null && _a !== void 0 ? _a : cell.source);
            continue;
        }
        if (!referents.has(cell.id))
            continue;
        const source = (_b = stripped.get(cell.id)) !== null && _b !== void 0 ? _b : cell.source;
        const result = await rewrite(cell.id, source);
        if (result !== null)
            expanded.push({ id: cell.id, source: result });
    }
    const overwritten = new Set(expanded.map(({ id }) => id));
    return {
        ...classification,
        sources: [
            ...classification.sources.filter(({ id }) => !overwritten.has(id)),
            ...expanded
        ],
        warnings: [...classification.warnings, ...warnings]
    };
}
/**
 * Expand autotest directives in test cells by leasing a kernel,
 * executing answer cells for their definitions, then evaluating each
 * expression and replacing directives with generated Python tests.
 *
 * Returns the classification unchanged (with a warning) when no
 * kernel is available.
 */
async function expand(workbook, cells, classification) {
    var _a, _b;
    const leased = await _kernels__rspack_import_0.lease(workbook);
    if (!leased) {
        const { defaultKernelName: name } = workbook.context.model;
        const warnings = [
            ...classification.warnings,
            `AUTOTEST and HASHED AUTOTEST cells could not be expanded (no ${name !== null && name !== void 0 ? name : 'kernel'} available); the rest of conversion continued unchanged`
        ];
        return { ...classification, warnings };
    }
    const [kernel, release] = leased;
    try {
        const fallback = workbook.context.model.defaultKernelName || null;
        const name = (_a = await language(kernel)) !== null && _a !== void 0 ? _a : guess(fallback);
        const execute = executor(kernel);
        if (name !== 'python') {
            const resolve = async (expr) => ({ safe: false, value: await execute(expr) });
            const warnings = [
                ...classification.warnings,
                `Only AUTOTEST and HASHED AUTOTEST expansion requires a Python kernel; found "${(_b = name !== null && name !== void 0 ? name : fallback) !== null && _b !== void 0 ? _b : 'unknown'}". The rest of conversion continued unchanged`
            ];
            return await spread(cells, { ...classification, warnings }, execute, resolve);
        }
        return await spread(cells, classification, execute, resolver(kernel, python));
    }
    finally {
        void release();
    }
}
/**
 * Detect, classify, and apply nbgrader cell metadata to a workbook.
 *
 * @returns a summary report on success, or null when the notebook
 * contains no nbgrader metadata.
 */
async function convert(workbook, trans) {
    var _a;
    const notebook = workbook.context.model.sharedModel;
    const raw = notebook.cells.map(cell => ({
        id: cell.id,
        cell_type: cell.cell_type,
        source: cell.getSource(),
        metadata: cell.toJSON().metadata
    }));
    if (!detect(raw))
        return null;
    // Pass 1: split hidden test regions into separate cells.
    const { cells, sources: initial, splits } = presplit(raw);
    // Pass 2: classify the (already-split) cells.
    let classification = classify(cells);
    classification = {
        ...classification,
        sources: [...initial, ...classification.sources],
        splits
    };
    const referents = new Set(classification.references.flat().map(ref => ref.referent));
    const pending = cells.some(cell => referents.has(cell.id) && autotests(cell.source));
    if (pending)
        classification = await expand(workbook, cells, classification);
    for (const warning of classification.warnings)
        console.warn('nbgrader convert:', warning);
    // Build source cache once for both split insertion and final cleanup.
    const cached = new Map(classification.sources.map(({ id, source }) => [id, source]));
    // Insert hidden test cells extracted by presplit.
    for (const split of classification.splits) {
        const index = notebook.cells.findIndex(({ id }) => id === split.cell);
        if (index < 0)
            continue;
        notebook.insertCell(index + 1, {
            cell_type: 'code',
            source: (_a = cached.get(split.referent)) !== null && _a !== void 0 ? _a : split.source,
            metadata: {}
        });
        const actual = notebook.cells[index + 1].id;
        if (actual === split.referent)
            continue;
        for (const references of classification.references) {
            for (const ref of references) {
                if (ref.referent === split.referent)
                    ref.referent = actual;
            }
        }
        for (const cell of classification.cells) {
            if (!cell.references)
                continue;
            cell.references =
                cell.references.map(id => id === split.referent ? actual : id);
        }
    }
    for (let i = 0; i < classification.cells.length; i++) {
        await _workbook__rspack_import_1.Workbook.add(workbook, classification.cells[i], classification.references[i]);
    }
    notebook.transact(() => {
        for (const cell of [...notebook.cells]) {
            const json = cell.toJSON();
            const source = cached.get(cell.id);
            const metadata = json.metadata;
            const marked = !!metadata && 'nbgrader' in metadata;
            if (source === undefined && !marked)
                continue;
            // Rewrite in place so rubric cell IDs stay aligned with notebook cells.
            cell.transact(() => {
                if (source !== undefined)
                    cell.setSource(source);
                if (marked)
                    cell.deleteMetadata('nbgrader');
            });
        }
    }, false);
    return report(raw, classification, trans);
}


},
"./lib/correxit/propagator.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  propagate: () => (propagate)
});
/* import */ var _jupyterlab_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_0);
/* import */ var ___rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/assignment.js");
/* import */ var _io__rspack_import_2 = __webpack_require__("./lib/correxit/io.js");
/* import */ var _security__rspack_import_4 = __webpack_require__("./lib/correxit/security.js");




async function* propagate({ commands, distributor, factory, manager, overwrite, workbook }) {
    const rubric = ___rspack_import_1.Workbook.open(workbook, true);
    if (!rubric || rubric.locked) {
        yield { type: 'error', slots: ['invalid rubric'] };
        return;
    }
    try {
        const { assignment: { roster }, key } = rubric;
        const path = workbook.context.path;
        const parent = _jupyterlab_coreutils__rspack_import_0.PathExt.dirname(path);
        const stem = _jupyterlab_coreutils__rspack_import_0.PathExt.basename(path, '.ipynb');
        const potential = await _io__rspack_import_2.available(manager, parent, stem);
        const directory = await _io__rspack_import_2.mkdir(manager, parent, potential);
        const total = roster.length;
        const source = workbook.context.model.sharedModel.toJSON();
        const { encrypted, notebook: content } = await ___rspack_import_3.Assignment.prepare(source, rubric);
        const author = await _security__rspack_import_4.decrypt(rubric.assignment.keys.private.author, rubric.key);
        let progress = 0;
        yield { type: 'mkdir', slots: [directory.path] };
        for (const reference of encrypted)
            yield { type: 'encrypted', slots: [reference] };
        const load = async (name) => ({ name, data: await _io__rspack_import_2.load(manager, parent, name) });
        let resources = null;
        if (rubric.assignment.resources) {
            try {
                resources = await Promise.all(rubric.assignment.resources.map(load));
                await Promise.all(resources.map(({ data, name }) => _io__rspack_import_2.write(manager, _jupyterlab_coreutils__rspack_import_0.PathExt.join(directory.path, name), data)));
            }
            catch (error) {
                yield { type: 'error', slots: [`${error}`] };
                return;
            }
        }
        for (const assignee of roster) {
            yield { type: 'separator', slots: [] };
            const notebook = JSON.parse(JSON.stringify(content));
            const file = await ___rspack_import_3.Assignment.filename(stem, assignee);
            const path = _jupyterlab_coreutils__rspack_import_0.PathExt.join(directory.path, file);
            const issued = await ___rspack_import_3.Assignment.issue({
                assignee,
                author,
                distribution: null,
                file,
                key,
                notebook,
                roster
            });
            const { identifier } = issued;
            const propagated = { identifier, notebook, overwrite, path, resources };
            ___rspack_import_3.Assignment.stamp(notebook, Date.now());
            let distributed = true;
            try {
                if (!await distributor(propagated)) {
                    yield { type: 'skipped', slots: [assignee] };
                    yield { type: 'progress', slots: [++progress, total] };
                    continue;
                }
            }
            catch (error) {
                ___rspack_import_3.Assignment.stamp(notebook, null);
                distributed = false;
                yield {
                    type: 'distribute-error',
                    slots: [assignee, path, `${error}`]
                };
            }
            const created = await _io__rspack_import_2.create({ factory, manager, notebook, path });
            yield { type: 'assigned', slots: [assignee] };
            yield { type: created ? 'saved' : 'create-error', slots: [path] };
            if (created && distributed)
                yield { type: 'distributed', slots: [assignee] };
            yield { type: 'progress', slots: [++progress, total] };
        }
        await _io__rspack_import_2.cd(commands, directory.path);
        yield { type: 'success', slots: [total] };
    }
    catch (error) {
        yield { type: 'error', slots: [`${error}`] };
    }
}


},
"./lib/correxit/providers/moodle.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Moodle: () => (Moodle)
});
/* import */ var _jupyterlab_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_0);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/assignment.js");
/* import */ var _error__rspack_import_1 = __webpack_require__("./lib/correxit/error.js");



var Moodle;
(function (Moodle) {
    const api = (url, token) => {
        const endpoint = `${url}/webservice/rest/server.php`;
        return async (action, params = '') => {
            const body = new URLSearchParams(params);
            body.set('wstoken', token);
            body.set('wsfunction', action);
            body.set('moodlewsrestformat', 'json');
            const response = await fetch(endpoint, { method: 'POST', body });
            if (!response.ok)
                throw new _error__rspack_import_1.Plugin(`${action} failed (status ${response.status})`);
            const payload = await response.json();
            if (payload && typeof payload === 'object' && 'exception' in payload)
                throw new _error__rspack_import_1.Plugin(payload.message || `${action} failed`);
            return payload;
        };
    };
    const identify = ({ email, fullname, id, idnumber, username }) => username || email || idnumber || fullname || `${id}`;
    const student = ({ roles = [] }) => !roles.length || roles.some(({ shortname }) => shortname === 'student');
    const normalize = (records) => [...new Set(records.filter(student).map(identify))].filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    const upload = async (url, token, content, filename, itemid = 0) => {
        var _a;
        const form = new FormData();
        const type = typeof content === 'string'
            ? 'application/json'
            : 'application/octet-stream';
        const blob = new Blob([content], { type });
        form.append('token', token);
        form.append('filearea', 'draft');
        form.append('itemid', String(itemid));
        form.append('file_1', blob, filename);
        const response = await fetch(`${url}/webservice/upload.php`, {
            method: 'POST',
            body: form
        });
        if (!response.ok) {
            const reason = await response.text().catch(() => '');
            const message = reason ||
                `Upload failed (${response.status} ${response.statusText})`;
            throw new _error__rspack_import_1.Plugin(message);
        }
        const draft = await response.json();
        if (Array.isArray(draft) && ((_a = draft[0]) === null || _a === void 0 ? void 0 : _a.itemid))
            return draft[0].itemid;
        const reason = (draft === null || draft === void 0 ? void 0 : draft.error) || (draft === null || draft === void 0 ? void 0 : draft.message) || 'Upload returned no item';
        throw new _error__rspack_import_1.Plugin(reason);
    };
    const TTL = 5 * 60000;
    const participants = new Map();
    const scales = new Map();
    const scale = async (request, course, assignment) => {
        const key = `${course}:${assignment}`;
        const cached = scales.get(key);
        if (cached && cached.expires > Date.now())
            return cached.max;
        const records = await request('mod_assign_get_assignments', `courseids[0]=${course}`);
        const found = records.courses
            .flatMap(({ assignments }) => assignments)
            .find(({ id }) => String(id) === assignment);
        const max = found && found.grade > 0 ? found.grade : 100;
        scales.set(key, { expires: Date.now() + TTL, max });
        return max;
    };
    const enroll = async (request, course) => {
        const cached = participants.get(course);
        if (cached && cached.expires > Date.now())
            return cached.users;
        const users = await request('core_enrol_get_enrolled_users', `courseid=${course}`);
        return remember(course, users);
    };
    const remember = (course, users) => {
        const enrolled = new Map(users.map(user => [identify(user), user.id]));
        participants.set(String(course), { expires: Date.now() + TTL, users: enrolled });
        return enrolled;
    };
    async function collector(certified, settings) {
        const { token, url: raw } = settings;
        const url = _jupyterlab_coreutils__rspack_import_0.URLExt.normalize(raw);
        if (!token || !url)
            throw new _error__rspack_import_1.Plugin('Moodle URL or token not configured');
        const rubric = ___rspack_import_2.Workbook.open(certified.workbook, true);
        if (!rubric)
            throw new _error__rspack_import_1.Plugin('collector error: no rubric');
        const compound = rubric.assignment.id;
        if (!compound)
            throw new _error__rspack_import_1.Plugin('collector error: no assignment ID');
        const [course, assignment] = compound.split(':');
        if (!course || !assignment)
            throw new _error__rspack_import_1.Plugin('collector error: invalid assignment ID format');
        const request = api(url, token);
        const { assignee } = certified.identifier;
        const enrolled = await enroll(request, course);
        const uid = enrolled.get(assignee);
        if (uid === undefined)
            throw new _error__rspack_import_1.Plugin(`collector error: no Moodle user for ${assignee}`);
        const notebook = certified.workbook.context.model.sharedModel.toJSON();
        const content = JSON.stringify(notebook);
        const file = await ___rspack_import_3.Assignment.filename(rubric.assignment.name, assignee);
        const item = await upload(url, token, content, file);
        if (!item)
            throw new _error__rspack_import_1.Plugin(`collector error: upload failed (${assignee})`);
        const { points, possible } = certified.grade.score;
        const max = await scale(request, course, assignment);
        const grade = possible > 0 ? (points / possible) * max : 0;
        await request('mod_assign_save_grade', [
            `assignmentid=${assignment}`,
            `userid=${uid}`,
            `grade=${grade}`,
            'attemptnumber=-1',
            'addattempt=0',
            'workflowstate=',
            'applytoall=0',
            `plugindata[files_filemanager]=${item}`
        ].join('&'));
        return `moodle:${assignment}:${uid}:${item}`;
    }
    Moodle.collector = collector;
    async function distributor(parameters, settings) {
        const { identifier, notebook, overwrite, resources } = parameters;
        const { token, url: raw } = settings;
        const url = _jupyterlab_coreutils__rspack_import_0.URLExt.normalize(raw);
        if (!token || !url)
            throw new _error__rspack_import_1.Plugin('Moodle URL or token not configured');
        if (!identifier.assignment)
            throw new _error__rspack_import_1.Plugin('No external assignment ID');
        const { assignee } = identifier;
        const [course, assignment] = identifier.assignment.split(':');
        if (!course || !assignment)
            throw new _error__rspack_import_1.Plugin('Invalid assignment ID format');
        const request = api(url, token);
        const user = (await enroll(request, course)).get(assignee);
        if (user === undefined)
            throw new _error__rspack_import_1.Plugin(`No Moodle user for ${assignee}`);
        if (!overwrite) {
            const result = await request('mod_assign_get_grades', `assignmentids[0]=${assignment}`);
            const assigned = result.assignments.flatMap(({ grades }) => grades)
                .some(({ userid }) => userid === user);
            if (assigned)
                return false;
        }
        const metadata = notebook.metadata['correxit'];
        const { name } = metadata.assignment;
        const base = (name || `moodle-${course}-${assignment}`).toLocaleLowerCase();
        const file = await ___rspack_import_3.Assignment.filename(base, assignee);
        const content = JSON.stringify(notebook);
        let draft = await upload(url, token, content, file);
        if (resources) {
            for (const resource of resources) {
                draft = await upload(url, token, resource.data.buffer, resource.name, draft);
            }
        }
        await request('mod_assign_save_grade', [
            `assignmentid=${assignment}`,
            `userid=${user}`,
            'grade=-1',
            'attemptnumber=-1',
            'addattempt=0',
            'workflowstate=',
            'applytoall=0',
            `plugindata[files_filemanager]=${draft}`
        ].join('&'));
        return true;
    }
    Moodle.distributor = distributor;
    async function registrar(workbook, identifier, settings) {
        const { token, url: raw } = settings;
        const url = _jupyterlab_coreutils__rspack_import_0.URLExt.normalize(raw);
        if (!token || !url)
            return null;
        const request = api(url, token);
        const records = await request('mod_assign_get_assignments');
        const populated = ({ assignments }) => assignments.length > 0;
        const courses = records.courses.filter(populated)
            .sort((a, b) => a.id - b.id ||
            (a.fullname || a.shortname || '').localeCompare(b.fullname || b.shortname || ''));
        const rosters = await Promise.all(courses.map(async ({ id: course }) => {
            const users = await request('core_enrol_get_enrolled_users', `courseid=${course}`);
            remember(course, users);
            return [course, normalize(users)];
        }));
        const roster = Object.fromEntries(rosters);
        return courses.map(course => ({
            assignments: course.assignments
                .map(assignment => {
                var _a;
                return ({
                    expiration: assignment.duedate ? assignment.duedate * 1000 : null,
                    id: `${course.id}:${assignment.id}`,
                    name: assignment.name,
                    roster: (_a = roster[course.id]) !== null && _a !== void 0 ? _a : []
                });
            })
                .sort((a, b) => {
                if (a.expiration && b.expiration)
                    return a.expiration - b.expiration || a.name.localeCompare(b.name);
                if (a.expiration)
                    return -1;
                if (b.expiration)
                    return 1;
                return a.name.localeCompare(b.name);
            }),
            group: course.fullname || course.shortname || String(course.id)
        }));
    }
    Moodle.registrar = registrar;
})(Moodle || (Moodle = {}));


},
"./lib/correxit/registrars.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  manual: () => (manual)
});
const manual = async () => null;


},
"./lib/correxit/rubric.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Rubric: () => (Rubric)
});
/* import */ var _lumino_algorithm__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@lumino/algorithm");
/* import */ var _lumino_algorithm__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_lumino_algorithm__rspack_import_0);
/* import */ var _error__rspack_import_2 = __webpack_require__("./lib/correxit/error.js");
/* import */ var _security__rspack_import_1 = __webpack_require__("./lib/correxit/security.js");



/** Immutable assignment, cell, reference, and scoring data. */
var Rubric;
(function (Rubric) {
    /** Current persisted Correxit metadata format. */
    Rubric.CXTFORMAT = 1;
    let Cell;
    (function (Cell) {
        let Output;
        (function (Output) {
            Output.error = ({ header }) => header.msg_type === 'error';
            Output.stdout = (output) => Output.stream(output) &&
                output.content.name === 'stdout';
            Output.stream = ({ header }) => header.msg_type === 'stream';
            Output.text = (output) => output.content.text;
        })(Output || (Output = {}));
        Cell.TOOLBAR = 'correxit:cell-toolbar';
        Cell.types = Object.freeze(['answerable', 'comparable', 'correctable', 'reviewable']);
        async function answer([expected], given) {
            const { error, stdout, stream, text } = Output;
            if (!expected)
                return { ...Score.UNSCORED, code: 'empty-expected' };
            if (!given.length)
                return { ...Score.INCORRECT, code: 'empty-given' };
            if ((0,_lumino_algorithm__rspack_import_0.find)(given, error))
                return { ...Score.INCORRECT, code: 'error-given' };
            if ((0,_lumino_algorithm__rspack_import_0.find)(given, stream)) {
                const answered = given.filter(stdout).map(text).join('').trim();
                if (answered) {
                    const digest = await _security__rspack_import_1.digest(answered);
                    const score = digest === expected ? Score.CORRECT : Score.INCORRECT;
                    const code = score === Score.INCORRECT ? 'mismatch-digest' : '';
                    return { ...score, code };
                }
                return { ...Score.INCORRECT, code: 'missing-stdout' };
            }
            return { ...Score.UNSCORED, code: 'mismatch-message' };
        }
        Cell.answer = answer;
        async function compare(expected, given) {
            if (!expected.length)
                return { ...Score.UNSCORED, code: 'empty-expected' };
            if (!given.length)
                return { ...Score.INCORRECT, code: 'empty-given' };
            const order = (value) => {
                if (Array.isArray(value))
                    return value.map(order);
                if (typeof value !== 'object' || value === null)
                    return value;
                const record = value;
                return Object.fromEntries(Object.keys(record).sort().map(key => [key, order(record[key])]));
            };
            const shape = (content) => Object.keys(content).sort().join('');
            const [{ content: x }] = expected.slice(-1);
            const [{ content: y }] = given.slice(-1);
            if (shape(x) !== shape(y))
                return { ...Score.INCORRECT, code: 'mismatch-congruence' };
            if ('data' in x && 'data' in y) {
                const equal = JSON.stringify(order(x.data)) ===
                    JSON.stringify(order(y.data));
                const error = { ...Score.INCORRECT, code: 'mismatch-data' };
                return equal ? Score.CORRECT : error;
            }
            if ('name' in x && 'name' in y) {
                const error = { ...Score.INCORRECT, code: 'mismatch-name-text' };
                return x.name === y.name && x.text === y.text ? Score.CORRECT : error;
            }
            return { ...Score.UNSCORED, code: 'error-compare' };
        }
        Cell.compare = compare;
        ;
        async function correct(expected) {
            return expected.some(Output.error) ? Score.INCORRECT : Score.CORRECT;
        }
        Cell.correct = correct;
        /**
         * Execute one cell's source in a kernel.
         *
         * @param kernel - the kernel to use.
         * @param cell - the model of the cell to execute.
         *
         * @returns an array of of cell outputs.
         */
        async function execute({ sharedModel: cell }, kernel) {
            const outputs = [];
            const code = cell.getSource();
            if (!code.length)
                return outputs;
            const dispose = true;
            const future = kernel.requestExecute({ code }, dispose);
            future.onIOPub = (message) => {
                if (message.header.msg_type === 'execute_result' ||
                    message.header.msg_type === 'display_data' ||
                    message.header.msg_type === 'stream' ||
                    message.header.msg_type === 'error')
                    outputs.push(message);
            };
            await future.done;
            return outputs;
        }
        Cell.execute = execute;
        async function review(intervention) {
            return intervention !== null && intervention !== void 0 ? intervention : { ...Score.UNSCORED, code: 'intervene' };
        }
        Cell.review = review;
        /** @returns a rubric with the possible points for a given cell updated. */
        function reweight(rubric, id, possible) {
            const cell = get(rubric, id);
            if (!cell)
                throw new _error__rspack_import_2.Invalid(`reweight error, cell ${id} not in rubric`);
            const assignment = {
                ...rubric.assignment,
                report: Assignment.Report.empty()
            };
            const cells = { ...rubric.cells, [id]: { ...cell, points: possible } };
            return { ...rubric, assignment, cells, revised: Date.now() };
        }
        Cell.reweight = reweight;
        /**
         * Get the score for a single cell.
         *
         * @param rubric - the rubric that defines the cell being scored.
         * @param id - the id of the cell to score.
         * @param outputs - the outputs of all the executed workbook cells.
         *
         * @returns a promise that resolves to the score for this cell.
         */
        async function score(rubric, id, outputs) {
            const cell = get(rubric, id);
            const given = outputs.get(id);
            const intervention = rubric.assignment.report.interventions[id];
            if (!cell)
                return { ...Score.UNSCORED, code: 'missing-cell-given', id };
            const possible = cell.points;
            if (cell.is === 'reviewable') {
                const score = await review(intervention !== null && intervention !== void 0 ? intervention : null);
                if (score.status === 'unscored')
                    return { ...score, id, possible };
                const capped = Math.max(0, Math.min(score.points, possible));
                const status = capped === possible ? 'correct'
                    : capped === 0 ? 'incorrect'
                        : 'partial';
                return { ...score, id, points: capped, possible, status };
            }
            if (!given)
                return { ...Score.INCORRECT, code: 'missing-given', id, possible };
            if (cell.is === 'answerable') {
                const points = ({ status }) => status === 'correct' ? possible : 0;
                const score = await answer(cell.payload, given);
                return { ...score, id, points: points(score), possible };
            }
            const references = Object.values(rubric.references)
                .filter(reference => reference.cell === id);
            const visible = rubric.locked
                ? references.filter(reference => !reference.secret)
                : references;
            if (cell.is === 'comparable') {
                const [reference] = visible;
                if (!reference)
                    return { ...Score.INCORRECT, code: 'locked', id, possible };
                const expected = outputs.get(reference.referent);
                if (!expected) {
                    return {
                        ...Score.INCORRECT, code: 'missing-reference', id, possible
                    };
                }
                const points = ({ status }) => status === 'correct' ? possible : 0;
                const score = await compare(expected, given);
                return { ...score, id, points: points(score), possible };
            }
            if (cell.is === 'correctable') {
                if (!visible.length)
                    return { ...Score.INCORRECT, code: 'locked', id, possible };
                const total = visible.reduce((sum, { points }) => sum + points, 0);
                let earned = 0;
                let missing = false;
                for (const reference of visible) {
                    const expected = outputs.get(reference.referent);
                    if (!expected) {
                        missing = true;
                        continue;
                    }
                    const result = await correct(expected);
                    if (result.status === 'correct')
                        earned += reference.points;
                }
                const code = missing ? 'missing-reference' : '';
                const status = earned === total ? 'correct' : earned === 0 ? 'incorrect' : 'partial';
                return {
                    ...Score.CORRECT, code, id,
                    points: earned, possible: total, status
                };
            }
            return { ...Score.UNSCORED, code: 'error-is-unknown', id };
        }
        Cell.score = score;
    })(Cell = Rubric.Cell || (Rubric.Cell = {}));
    let Reference;
    (function (Reference) {
        /** @returns a rubric with a reference's points updated. */
        function reweight(rubric, referent, points) {
            const reference = rubric.references[referent];
            if (!reference)
                throw new _error__rspack_import_2.Invalid(`reweight: reference ${referent} not found`);
            const cell = get(rubric, reference.cell);
            if (!cell || cell.is !== 'correctable')
                throw new _error__rspack_import_2.Invalid(`reweight: cell ${reference.cell} invalid`);
            const assignment = {
                ...rubric.assignment,
                report: Assignment.Report.empty()
            };
            const updated = { ...reference, points };
            const total = cell.references.reduce((sum, id) => sum + (id === referent ? points : rubric.references[id].points), 0);
            const cells = {
                ...rubric.cells,
                [cell.id]: { ...cell, points: total }
            };
            const references = {
                ...rubric.references, [referent]: updated
            };
            return {
                ...rubric, assignment, cells,
                references, revised: Date.now()
            };
        }
        Reference.reweight = reweight;
    })(Reference = Rubric.Reference || (Rubric.Reference = {}));
    let Assignment;
    (function (Assignment) {
        let Equal;
        (function (Equal) {
            const course = (x, y) => x.group === y.group &&
                registrations(x.assignments, y.assignments);
            const normalize = (x) => x.length && 'group' in x[0]
                ? x
                : [{ assignments: x, group: '' }];
            const registration = (x, y) => (x.expiration === y.expiration &&
                x.id === y.id &&
                x.name === y.name &&
                roster(x.roster, y.roster));
            const registrations = (x, y) => x.length === y.length &&
                x.every((a, i) => registration(a, y[i]));
            const roster = (x, y) => x.length === y.length &&
                x.every((record, i) => record === y[i]);
            function assignment(x, y) {
                return x.assignee === y.assignee &&
                    x.overdue === y.overdue &&
                    x.penalty === y.penalty &&
                    registration(x, y) &&
                    resources(x, y);
            }
            Equal.assignment = assignment;
            function registered(x, y) {
                if (x === y)
                    return true;
                if (x === null || y === null)
                    return false;
                if (x.length !== y.length)
                    return false;
                if (!x.length)
                    return true;
                const a = normalize(x), b = normalize(y);
                return a.length === b.length &&
                    a.every((c, i) => course(c, b[i]));
            }
            Equal.registered = registered;
            function resources({ resources: x }, { resources: y }) {
                var _a, _b;
                return ((_a = x === null || x === void 0 ? void 0 : x.join('\x1F')) !== null && _a !== void 0 ? _a : null) === ((_b = y === null || y === void 0 ? void 0 : y.join('\x1F')) !== null && _b !== void 0 ? _b : null);
            }
            Equal.resources = resources;
        })(Equal = Assignment.Equal || (Assignment.Equal = {}));
        let Report;
        (function (Report) {
            function empty() {
                return Object.freeze({ interventions: {}, kernel: null, scores: {} });
            }
            Report.empty = empty;
        })(Report = Assignment.Report || (Assignment.Report = {}));
        let Keys;
        (function (Keys) {
            function author(keys) {
                return { private: keys.private.author, public: keys.public.author };
            }
            Keys.author = author;
            function empty() {
                return Object.freeze({
                    private: Object.freeze({ assignee: null, author: '' }),
                    public: Object.freeze({ assignee: null, author: '' })
                });
            }
            Keys.empty = empty;
        })(Keys = Assignment.Keys || (Assignment.Keys = {}));
        function empty() {
            return Object.freeze({
                assignee: '',
                certification: null,
                collected: null,
                distribution: null,
                expiration: null,
                id: null,
                issue: '',
                issuer: '',
                keys: Keys.empty(),
                mac: '',
                name: '',
                overdue: null,
                penalty: null,
                report: Report.empty(),
                resources: null,
                roster: [],
                seal: null,
                submission: null,
                submitted: null
            });
        }
        Assignment.empty = empty;
        /** @returns whether an assignment has complete issuance credentials. */
        function issued({ assignee, issue, issuer }) {
            return !!(assignee && issue && issuer);
        }
        Assignment.issued = issued;
        /**
         * @returns an amended copy of the assignment report with new scores added.
         * @param id - if the cell is not specified, all cells are scored.
         *
         * #### Notes
         * If `id` is not provided, every cell in the rubric is scored. Cells that
         * failed to execute (missing from outputs) will be marked as incorrect.
         * All scores that already exist from previous scoring remain untouched as
         * long as they exist in the rubric and have not been rescored.
         */
        async function score(rubric, outputs, id) {
            const { assignment: { report } } = rubric;
            const valid = (id) => has(rubric, id);
            const subset = (id ? [id] : Array.from(outputs.keys())).filter(valid);
            const unexecuted = (id) => !subset.includes(id) && valid(id);
            const missing = id ? [] : Object.keys(rubric.cells).filter(unexecuted);
            const all = [...subset, ...missing];
            if (!all.length)
                return report;
            const current = Object.entries(report.scores).filter(([id]) => valid(id));
            const pending = all.map(id => Cell.score(rubric, id, outputs));
            const done = (await Promise.all(pending)).map(score => [score.id, score]);
            const scores = Object.fromEntries([...current, ...done]);
            return { ...report, scores };
        }
        Assignment.score = score;
        async function issue({ assignment, notebook, rubric }) {
            const sources = notebook.cells
                .map(({ id, source, cell_type }) => [
                String(id),
                cell_type,
                Array.isArray(source) ? source.join('') : source
            ])
                .sort(([a], [b]) => a.localeCompare(b));
            const cells = Object.fromEntries(Object.entries(rubric.cells).sort(([a], [b]) => a.localeCompare(b)));
            const references = Object.fromEntries(Object.entries(rubric.references).sort(([a], [b]) => a.localeCompare(b)));
            return _security__rspack_import_1.digest(JSON.stringify({
                assignee: assignment.assignee,
                assignment: assignment.id,
                cells,
                cxtformat: rubric.cxtformat,
                expiration: assignment.expiration,
                name: assignment.name,
                overdue: assignment.overdue,
                penalty: assignment.penalty,
                references,
                rubric: rubric.id,
                sources
            }));
        }
        Assignment.issue = issue;
        async function issuer(issue, author) {
            return _security__rspack_import_1.sign(issue, author);
        }
        Assignment.issuer = issuer;
        async function unstarted({ assignment, notebook, rubric }) {
            if (!assignment.issue || !assignment.issuer)
                return false;
            const verified = await _security__rspack_import_1.verify(assignment.issuer, assignment.keys.public.author);
            if (verified !== assignment.issue)
                return false;
            const current = await issue({ assignment, notebook, rubric });
            return current === assignment.issue;
        }
        Assignment.unstarted = unstarted;
        function late({ expiration, submission }) {
            return expiration !== null &&
                submission !== null &&
                submission > expiration;
        }
        Assignment.late = late;
        function rejected(assignment) {
            return assignment.overdue === 'reject' && late(assignment);
        }
        Assignment.rejected = rejected;
        function summary(report, assignment = null) {
            const { interventions, scores } = { ...Report.empty(), ...report };
            const ids = new Set([
                ...Object.keys(interventions),
                ...Object.keys(scores)
            ]);
            const sentinel = ({ possible, status }) => status === 'unscored' && possible === Score.UNSCORED.possible;
            const value = ({ points, status }) => status === 'unscored' ? 0 : points;
            const sum = (a, b) => {
                if (sentinel(a))
                    return b;
                if (sentinel(b))
                    return a;
                return {
                    code: '', comment: '', id: '',
                    points: value(a) + value(b),
                    possible: a.possible + b.possible,
                    status: 'summary'
                };
            };
            const summary = Array.from(ids)
                .map(id => { var _a; return (_a = Score.resolve(report, id)) !== null && _a !== void 0 ? _a : Score.UNSCORED; })
                .reduce(sum, Score.UNSCORED);
            if (!assignment ||
                assignment.overdue !== 'dock' ||
                assignment.penalty === null ||
                assignment.penalty <= 0 ||
                summary.status === 'unscored' ||
                !late(assignment))
                return summary;
            const deduction = Math.ceil(summary.possible * assignment.penalty / 100);
            const docked = Math.max(0, summary.points - deduction);
            return { ...summary, points: docked };
        }
        Assignment.summary = summary;
        async function validate(assignment) {
            const { assignee, issue, issuer, keys, mac, overdue, penalty, roster, seal } = assignment;
            const valid = ['accept', 'dock', 'reject'];
            if (!keys.private.author)
                throw new _error__rspack_import_2.Mismatch('missing author private key');
            if (!keys.public.author)
                throw new _error__rspack_import_2.Mismatch('missing author public key');
            if ((assignee || roster.length) && !mac)
                throw new _error__rspack_import_2.Mismatch('missing mac');
            if (assignee && !(0,_lumino_algorithm__rspack_import_0.find)(roster, record => record === assignee))
                throw new _error__rspack_import_2.Mismatch('assignee does not exist in roster');
            if (!!issue !== !!issuer)
                throw new _error__rspack_import_2.Mismatch('issue and issuer must appear together');
            if (overdue !== null && !valid.includes(overdue))
                throw new _error__rspack_import_2.Mismatch('invalid overdue policy');
            if (overdue === 'dock' && penalty === null)
                throw new _error__rspack_import_2.Mismatch('dock policy requires late penalty');
            if (penalty !== null && !Number.isInteger(penalty))
                throw new _error__rspack_import_2.Mismatch('invalid late penalty');
            if (penalty !== null && (penalty < 0 || penalty > 100))
                throw new _error__rspack_import_2.Mismatch('late penalty out of range');
            if (overdue !== 'dock' && penalty !== null)
                throw new _error__rspack_import_2.Mismatch('late penalty requires dock policy');
            if (issue) {
                const verified = await _security__rspack_import_1.verify(issuer, keys.public.author);
                if (verified !== issue)
                    throw new _error__rspack_import_2.Mismatch('issue signature mismatch');
            }
            if (seal && !keys.public.author)
                throw new _error__rspack_import_2.Mismatch('sealed assignment missing author public key');
            if (keys.private.assignee && !keys.public.assignee)
                throw new _error__rspack_import_2.Mismatch('assignee private key without public key');
        }
        Assignment.validate = validate;
    })(Assignment = Rubric.Assignment || (Rubric.Assignment = {}));
    let Score;
    (function (Score) {
        Score.CORRECT = Object.freeze({
            code: '',
            comment: '',
            id: '',
            points: 1,
            possible: 1,
            status: 'correct'
        });
        Score.INCORRECT = Object.freeze({
            code: '',
            comment: '',
            id: '',
            points: 0,
            possible: 1,
            status: 'incorrect'
        });
        Score.UNSCORED = Object.freeze({
            code: '',
            comment: '',
            id: '',
            points: -1,
            possible: -1,
            status: 'unscored'
        });
        /** @returns a copy of a cell's score that has been manually updated. */
        function intervene(id, score) {
            const { comment, points, possible } = score;
            if (!Number.isInteger(points))
                throw new TypeError('intervene: points invalid');
            if (!Number.isInteger(possible))
                throw new TypeError('intervene: possible invalid');
            if (possible < 1)
                throw new RangeError('intervene: possible < 1');
            if (points < 0 || points > possible)
                throw new RangeError('intervene: points out of range');
            const status = points === possible ? 'correct'
                : points === 0 ? 'incorrect'
                    : 'partial';
            return {
                code: 'intervene', comment, id,
                points, possible, status
            };
        }
        Score.intervene = intervene;
        /**
         * @returns the effective score for a cell, preferring any manual
         * intervention over the computed score.
         */
        function resolve(report, id) {
            var _a, _b;
            const { Report } = Assignment;
            const { interventions, scores } = { ...Report.empty(), ...report };
            return (_b = (_a = interventions[id]) !== null && _a !== void 0 ? _a : scores[id]) !== null && _b !== void 0 ? _b : null;
        }
        Score.resolve = resolve;
    })(Score = Rubric.Score || (Rubric.Score = {}));
    /** @returns a locked rubric with a submitted receipt. */
    function acknowledge(rubric, receipt = null) {
        if (!rubric.assignment.submission)
            throw new _error__rspack_import_2.Submit('acknowledge error: not submitted');
        const assignment = { ...rubric.assignment, submitted: receipt };
        return { ...rubric, assignment, revised: Date.now() };
    }
    Rubric.acknowledge = acknowledge;
    /** @returns an unlocked rubric that includes the added cell. */
    function add(rubric, cell, references = []) {
        if (has(rubric, cell.id) || cell.id in rubric.references)
            throw new _error__rspack_import_2.Invalid(`add error, cell id ${cell.id} already exists`);
        for (const reference of references) {
            const { cell: target, referent } = reference;
            if (target !== cell.id) {
                throw new _error__rspack_import_2.Invalid(`add error, reference ${referent} has wrong cell`);
            }
            if (referent in rubric.references) {
                throw new _error__rspack_import_2.Invalid(`add error, reference ${referent} already exists`);
            }
            if (referent in rubric.cells) {
                throw new _error__rspack_import_2.Invalid(`add error, reference ${referent} collides with cell`);
            }
        }
        const referents = references.map(({ referent }) => referent);
        if (cell.references === null && references.length)
            throw new _error__rspack_import_2.Invalid('add error, cell does not accept references');
        if (cell.references !== null) {
            const expected = new Set(cell.references);
            const mismatch = expected.size !== referents.length ||
                !referents.every(id => expected.delete(id));
            if (mismatch)
                throw new _error__rspack_import_2.Invalid('add error, cell.references mismatch');
        }
        const assignment = {
            ...rubric.assignment,
            report: Assignment.Report.empty()
        };
        const added = Object.fromEntries(references.map(reference => [reference.referent, reference]));
        const points = cell.is === 'correctable'
            ? references.reduce((sum, reference) => sum + reference.points, 0)
            : cell.points;
        const cells = { ...rubric.cells, [cell.id]: { ...cell, points } };
        return {
            ...rubric, assignment, cells,
            references: { ...rubric.references, ...added },
            revised: Date.now()
        };
    }
    Rubric.add = add;
    /** @returns an unlocked rubric with the given assignment details. */
    async function assign({ key, ...rubric }, { assignee = rubric.assignment.assignee, expiration = rubric.assignment.expiration, id = rubric.assignment.id, name = rubric.assignment.name, overdue = rubric.assignment.overdue, penalty = rubric.assignment.penalty, resources = rubric.assignment.resources, roster = rubric.assignment.roster } = {}) {
        roster = unique(roster);
        const stale = assignee !== rubric.assignment.assignee ||
            expiration !== rubric.assignment.expiration ||
            id !== rubric.assignment.id ||
            name !== rubric.assignment.name ||
            overdue !== rubric.assignment.overdue ||
            penalty !== rubric.assignment.penalty ||
            !Assignment.Equal.resources({ resources }, rubric.assignment) ||
            JSON.stringify(roster) !== JSON.stringify(rubric.assignment.roster);
        const certification = stale ? null : rubric.assignment.certification;
        const collected = stale ? null : rubric.assignment.collected;
        const distribution = stale ? null : rubric.assignment.distribution;
        const issue = stale ? '' : rubric.assignment.issue;
        const issuer = stale ? '' : rubric.assignment.issuer;
        const submission = stale ? null : rubric.assignment.submission;
        const submitted = stale ? null : rubric.assignment.submitted;
        const report = stale ? Assignment.Report.empty() : rubric.assignment.report;
        const keys = rubric.assignment.keys;
        const seal = rubric.assignment.seal;
        const unsigned = {
            assignee,
            expiration,
            id,
            issue,
            issuer,
            keys,
            name,
            overdue,
            penalty,
            report,
            resources,
            roster
        };
        const lifecycle = {
            certification, collected, distribution, seal, submission, submitted
        };
        const assignment = { ...unsigned, ...lifecycle, mac: '' };
        const assigned = { ...rubric, assignment, key, revised: Date.now() };
        const mac = await Rubric.mac(assigned, key);
        const signed = { ...assigned, assignment: { ...assignment, mac } };
        await Rubric.validate(signed);
        return signed;
    }
    Rubric.assign = assign;
    /**
     * @returns an unlocked rubric with the `key` field omitted. The client needs
     * to add a `key` field to use the rubric.
     */
    function create() {
        const revised = Date.now();
        const assignment = { ...Assignment.empty() };
        const encoded = revised.toString(36);
        const id = `wb${encoded}${crypto.randomUUID().split('-').shift()}`;
        return {
            assignment, cells: {}, cxtformat: Rubric.CXTFORMAT, id,
            locked: false, references: {}, revised
        };
    }
    Rubric.create = create;
    /** @returns a locked rubric with lifecycle timestamps nulled. */
    function draft(rubric) {
        if (rubric.assignment.seal)
            throw new _error__rspack_import_2.Submit('draft error: workbook is sealed');
        const assignment = {
            ...rubric.assignment,
            certification: null,
            collected: null,
            submission: null,
            submitted: null
        };
        return { ...rubric, assignment, revised: Date.now() };
    }
    Rubric.draft = draft;
    /** @returns an unlocked rubric with a certification timestamp. */
    function certify(rubric) {
        const certification = Date.now();
        const assignment = { ...rubric.assignment, certification, collected: null };
        return { ...rubric, assignment, revised: certification };
    }
    Rubric.certify = certify;
    /** @returns a locked rubric with a collected receipt. */
    function collect(rubric, receipt = null) {
        if (!rubric.assignment.certification)
            throw new _error__rspack_import_2.Certify('collect error: not certified');
        const revised = Date.now();
        const assignment = { ...rubric.assignment, collected: receipt };
        return { ...rubric, assignment, revised };
    }
    Rubric.collect = collect;
    /** Remove a single reference; removes the cell if none remain. */
    function dereference(rubric, referent) {
        const reference = rubric.references[referent];
        if (!reference) {
            throw new _error__rspack_import_2.Invalid(`dereference error, reference ${referent} not found`);
        }
        const cell = get(rubric, reference.cell);
        if (!cell || cell.is === 'answerable' || cell.is === 'reviewable') {
            throw new _error__rspack_import_2.Invalid(`dereference error, cell ${reference.cell} invalid`);
        }
        const remaining = cell.references.filter(id => id !== referent);
        if (!remaining.length)
            return remove(rubric, cell.id);
        const blank = Assignment.Report.empty();
        const assignment = { ...rubric.assignment, report: blank };
        const { [referent]: _, ...references } = rubric.references;
        const points = cell.is === 'correctable'
            ? remaining.reduce((sum, id) => sum + references[id].points, 0)
            : cell.points;
        const cells = {
            ...rubric.cells,
            [cell.id]: { ...cell, points, references: remaining }
        };
        return { ...rubric, assignment, cells, references, revised: Date.now() };
    }
    Rubric.dereference = dereference;
    function distribute(rubric) {
        const distribution = Date.now();
        const assignment = { ...rubric.assignment, distribution };
        return { ...rubric, assignment, revised: distribution };
    }
    Rubric.distribute = distribute;
    /** @returns the cell for `id`, or `null`. */
    function get(rubric, id) {
        return rubric.cells[id] || null;
    }
    Rubric.get = get;
    /** @returns whether a rubric has a cell with the given id. */
    function has(rubric, id) {
        return !!get(rubric, id);
    }
    Rubric.has = has;
    /** @returns the given rubric, locked. */
    async function lock(rubric) {
        if (rubric.locked)
            return rubric;
        const blank = { ...rubric.assignment, mac: '' };
        const unsigned = { ...rubric, assignment: blank };
        const mac = await Rubric.mac(unsigned, rubric.key);
        const signed = { ...unsigned, assignment: { ...blank, mac } };
        await Rubric.validate(signed);
        const locked = true;
        const { cells, cxtformat, id, key, references } = signed;
        const serialized = JSON.stringify(signed.assignment.roster);
        const roster = [await _security__rspack_import_1.encrypt(serialized, key)];
        const assignment = { ...signed.assignment, roster };
        const revised = Date.now();
        return {
            assignment, cells, cxtformat, id,
            key: null, locked, references, revised
        };
    }
    Rubric.lock = lock;
    /** @returns an HMAC associated with the given rubric. */
    async function mac(rubric, key) {
        return _security__rspack_import_1.hmac(JSON.stringify(terms(rubric)), key);
    }
    Rubric.mac = mac;
    /** @returns a normalized locked rubric or throws. */
    function normalize(rubric = {}) {
        const { assignment, cells, cxtformat, id, key, locked, references, revised } = rubric;
        const object = (value) => typeof value === 'object' && value !== null;
        const record = (value) => object(value) && !Array.isArray(value);
        const absent = (value, template) => {
            var _a;
            return (_a = Object.keys(template).find(field => !Object.prototype.hasOwnProperty.call(value, field) ||
                value[field] === undefined)) !== null && _a !== void 0 ? _a : null;
        };
        if (cxtformat !== Rubric.CXTFORMAT)
            throw new _error__rspack_import_2.Invalid('invalid rubric, unsupported cxtformat');
        if (!revised)
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing revised');
        if (typeof id !== 'string' || !id)
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing id');
        if (key !== null)
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing (null) key');
        if (locked !== true)
            throw new _error__rspack_import_2.Invalid('invalid rubric, must be locked');
        if (!record(cells))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing cells');
        if (!record(references))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing references');
        if (!record(assignment))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing assignment');
        const missing = absent(assignment, Assignment.empty());
        if (missing)
            throw new _error__rspack_import_2.Invalid(`invalid rubric, missing assignment ${missing}`);
        const { keys, report } = assignment;
        if (!record(keys))
            throw new _error__rspack_import_2.Invalid('invalid rubric, invalid assignment keys');
        const blank = Assignment.Keys.empty();
        if (absent(keys, blank))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing assignment key fields');
        const { private: secret, public: shared } = keys;
        if (!record(secret) || !record(shared))
            throw new _error__rspack_import_2.Invalid('invalid rubric, invalid assignment keys');
        if (absent(secret, blank.private) || absent(shared, blank.public))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing assignment key fields');
        if (typeof secret.author !== 'string' || !secret.author)
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing author private key');
        if (typeof shared.author !== 'string' || !shared.author)
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing author public key');
        if (!record(report))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing assignment report');
        const field = absent(report, Assignment.Report.empty());
        if (field)
            throw new _error__rspack_import_2.Invalid(`invalid rubric, missing assignment ${field}`);
        const { interventions, kernel, scores } = report;
        if (!record(interventions)) {
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing assignment interventions');
        }
        if (!record(scores))
            throw new _error__rspack_import_2.Invalid('invalid rubric, missing assignment scores');
        if (kernel !== null &&
            (!record(kernel) || !record(kernel.resources)))
            throw new _error__rspack_import_2.Invalid('invalid rubric, invalid kernel spec');
        return {
            assignment: assignment,
            cells, cxtformat, id, key, locked, references, revised
        };
    }
    Rubric.normalize = normalize;
    /** @returns whether any reviewable cell still needs an intervention. */
    function pending({ assignment, cells }) {
        const { report: { interventions } } = assignment;
        return Object.values(cells)
            .some(({ id, is }) => is === 'reviewable' && !interventions[id]);
    }
    Rubric.pending = pending;
    /** Provision a locked rubric with assignee keys for sealed submission. */
    function provision(rubric, keys) {
        const assignment = { ...rubric.assignment, keys };
        return { ...rubric, assignment, revised: Date.now() };
    }
    Rubric.provision = provision;
    /** Add a reference to an existing comparable or correctable cell. */
    function refer(rubric, id, reference) {
        const cell = get(rubric, id);
        if (!cell)
            throw new _error__rspack_import_2.Invalid(`refer error, cell ${id} not found`);
        if (cell.is !== 'comparable' && cell.is !== 'correctable')
            throw new _error__rspack_import_2.Invalid(`refer error, cell ${id} is ${cell.is}`);
        const { referent } = reference;
        if (referent in rubric.references) {
            throw new _error__rspack_import_2.Invalid(`refer error, reference ${referent} already exists`);
        }
        if (referent in rubric.cells)
            throw new _error__rspack_import_2.Invalid(`refer error, reference ${referent} collides`);
        const assignment = {
            ...rubric.assignment,
            report: Assignment.Report.empty()
        };
        const bound = { ...reference, cell: id };
        const references = { ...rubric.references, [referent]: bound };
        const local = [...cell.references, referent];
        const points = cell.is === 'correctable'
            ? local.reduce((sum, id) => sum + references[id].points, 0)
            : cell.points;
        const cells = {
            ...rubric.cells,
            [id]: { ...cell, points, references: local }
        };
        return { ...rubric, assignment, cells, references, revised: Date.now() };
    }
    Rubric.refer = refer;
    /** @returns an unlocked rubric which excludes the given cell. */
    function remove(rubric, id) {
        if (!get(rubric, id))
            return rubric;
        const assignment = {
            ...rubric.assignment,
            report: Assignment.Report.empty()
        };
        const { [id]: _, ...cells } = rubric.cells;
        const references = Object.fromEntries(Object.entries(rubric.references)
            .filter(([, reference]) => reference.cell !== id));
        return { ...rubric, assignment, cells, references, revised: Date.now() };
    }
    Rubric.remove = remove;
    /** @returns an unlocked rubric with a signed assignment report. */
    async function sign(rubric, report) {
        const assignment = { ...rubric.assignment, report, mac: '' };
        const signed = { ...rubric, assignment, revised: Date.now() };
        const mac = await Rubric.mac(signed, rubric.key);
        return { ...signed, assignment: { ...assignment, mac } };
    }
    Rubric.sign = sign;
    /** Record the submission timestamp for a locked workbook. */
    function submit(rubric, submission = Date.now()) {
        const assignment = { ...rubric.assignment, submission };
        return { ...rubric, assignment, revised: submission };
    }
    Rubric.submit = submit;
    /** Record a seal hash on a locked rubric. */
    function seal(rubric, hash) {
        const assignment = { ...rubric.assignment, seal: hash };
        return { ...rubric, assignment, revised: Date.now() };
    }
    Rubric.seal = seal;
    function terms(rubric) {
        return {
            assignment: authored(rubric.assignment),
            cells: cells(rubric.cells),
            cxtformat: rubric.cxtformat,
            id: rubric.id,
            references: references(rubric.references)
        };
    }
    Rubric.terms = terms;
    /** @returns a formatted rendition of a rubric timestamp. */
    function timestamp(timestamp, empty = '') {
        return timestamp !== null ? new Date(timestamp).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }) : empty;
    }
    Rubric.timestamp = timestamp;
    /** @returns a rubric with a reference's secret flag toggled. */
    function toggle(rubric, referent) {
        const reference = rubric.references[referent];
        if (!reference)
            throw new _error__rspack_import_2.Invalid(`toggle: reference ${referent} not found`);
        const assignment = {
            ...rubric.assignment,
            report: Assignment.Report.empty()
        };
        const toggled = { ...reference, secret: !reference.secret };
        const references = { ...rubric.references, [referent]: toggled };
        return { ...rubric, assignment, references, revised: Date.now() };
    }
    Rubric.toggle = toggle;
    /** @returns an unlocked rubric after decrypting the roster. */
    async function unlock(rubric, key) {
        const { cells, cxtformat, id, references, assignment: { roster: [block] } } = rubric;
        const roster = block ? JSON.parse(await _security__rspack_import_1.decrypt(block, key)) : [];
        const assignment = { ...rubric.assignment, roster };
        const revised = Date.now();
        const unlocked = {
            assignment, cells, cxtformat, id, key, locked: false, references, revised
        };
        await Rubric.validate(unlocked);
        return unlocked;
    }
    Rubric.unlock = unlock;
    /** Clear seal and student keys (for revise). */
    function unseal(rubric) {
        const keys = {
            private: { ...rubric.assignment.keys.private, assignee: null },
            public: { ...rubric.assignment.keys.public, assignee: null }
        };
        const assignment = {
            ...rubric.assignment,
            keys,
            seal: null,
            submission: null,
            submitted: null
        };
        return { ...rubric, assignment, revised: Date.now() };
    }
    Rubric.unseal = unseal;
    async function validate(rubric) {
        if (rubric.cxtformat !== Rubric.CXTFORMAT)
            throw new _error__rspack_import_2.Invalid('invalid rubric, unsupported cxtformat');
        const { assignment, key } = rubric;
        await Assignment.validate(assignment);
        if (!assignment.mac)
            return;
        if (assignment.mac === await mac(rubric, key))
            return;
        throw new _error__rspack_import_2.Mismatch('mac mismatch');
    }
    Rubric.validate = validate;
})(Rubric || (Rubric = {}));
const cell = (cell) => {
    const { id, is, payload, points } = cell;
    if (is === 'answerable')
        return { id, is, payload: [...payload], points, references: null };
    if (is === 'comparable' || is === 'correctable')
        return { id, is, payload, points, references: [...cell.references] };
    return { id, is, payload, points, references: null };
};
const authored = (assignment) => ({
    assignee: assignment.assignee,
    author: Rubric.Assignment.Keys.author(assignment.keys),
    expiration: assignment.expiration,
    id: assignment.id,
    issue: assignment.issue,
    issuer: assignment.issuer,
    name: assignment.name,
    overdue: assignment.overdue,
    penalty: assignment.penalty,
    report: report(assignment.report),
    resources: assignment.resources,
    roster: assignment.roster
});
const cells = (cells) => Object.fromEntries(Object.keys(cells).sort().map(id => [id, cell(cells[id])]));
const reference = ({ cell, points, referent, secret }) => ({ cell, points, referent, secret });
const references = (references) => Object.fromEntries(Object.keys(references)
    .sort()
    .map(id => [id, reference(references[id])]));
const report = ({ interventions, scores }) => ({
    interventions: sort(interventions),
    scores: sort(scores)
});
/** @returns a sorted record of scores for deterministic hashing. */
const sort = (scores) => Object.fromEntries(Object.keys(scores).sort().map(id => [id, scores[id]]));
/** @returns a list of strings with no duplicate values. */
const unique = (list) => Array.from(new Set(list));


},
"./lib/correxit/security.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  decrypt: () => (decrypt),
  digest: () => (digest),
  encrypt: () => (encrypt),
  encrypted: () => (encrypted),
  hmac: () => (hmac),
  keygen: () => (keygen),
  keypair: () => (keypair),
  parse: () => (parse),
  seal: () => (seal),
  sign: () => (sign),
  unseal: () => (unseal),
  verify: () => (verify)
});
/* import */ var openpgp__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/openpgp/openpgp");
/* import */ var openpgp__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(openpgp__rspack_import_0);

async function decrypt(text, password) {
    let message;
    try {
        message = await openpgp__rspack_import_0.readMessage({ armoredMessage: text });
    }
    catch (_a) {
        return text;
    }
    return (await openpgp__rspack_import_0.decrypt({ message, passwords: [password] })).data;
}
async function digest(text) {
    const encoded = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    const hexadecimal = (digit) => digit.toString(16).padStart(2, '0');
    return Array.from(new Uint8Array(hash)).map(hexadecimal).join('');
}
async function encrypt(text, password) {
    const message = await openpgp__rspack_import_0.createMessage({ text });
    return openpgp__rspack_import_0.encrypt({ message, passwords: [password] });
}
function encrypted(text) {
    return text.trimStart().startsWith('-----BEGIN PGP MESSAGE-----');
}
async function hmac(message, key) {
    const decode = (hex) => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return bytes.buffer;
    };
    const material = await crypto.subtle.importKey('raw', decode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', material, new TextEncoder().encode(message));
    const hexadecimal = (byte) => byte.toString(16).padStart(2, '0');
    return Array.from(new Uint8Array(signed)).map(hexadecimal).join('');
}
async function keygen(passphrase, salt) {
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations: 600000,
        hash: 'SHA-256'
    }, material, 256);
    const hexadecimal = (byte) => byte.toString(16).padStart(2, '0');
    return Array.from(new Uint8Array(bits)).map(hexadecimal).join('');
}
/** Generate an ECC Curve25519 keypair. The private key is unprotected. */
async function keypair() {
    const { publicKey, privateKey } = await openpgp__rspack_import_0.generateKey({
        type: 'curve25519',
        userIDs: [{ name: 'correxit' }],
        format: 'armored'
    });
    return { public: publicKey, private: privateKey };
}
/** Parse an armored PGP private key for reuse across multiple unseal calls. */
async function parse(armored) {
    return openpgp__rspack_import_0.readPrivateKey({ armoredKey: armored });
}
/** Encrypt text to one or more PGP public keys. */
async function seal(text, recipients) {
    const message = await openpgp__rspack_import_0.createMessage({ text });
    const keys = recipients.map(armored => openpgp__rspack_import_0.readKey({ armoredKey: armored }));
    return openpgp__rspack_import_0.encrypt({ message, encryptionKeys: await Promise.all(keys) });
}
/** Create an armored cleartext signature over public text. */
async function sign(text, signer) {
    const key = typeof signer === 'string'
        ? await parse(signer)
        : signer;
    const message = await openpgp__rspack_import_0.createCleartextMessage({ text });
    return openpgp__rspack_import_0.sign({ message, signingKeys: key });
}
/** Decrypt PGP ciphertext using a parsed or armored private key. */
async function unseal(text, recipient) {
    const key = typeof recipient === 'string'
        ? await parse(recipient) : recipient;
    const message = await openpgp__rspack_import_0.readMessage({ armoredMessage: text });
    return (await openpgp__rspack_import_0.decrypt({ message, decryptionKeys: key }))
        .data;
}
/** Verify an armored cleartext signature and return its signed text. */
async function verify(text, signer) {
    const message = await openpgp__rspack_import_0.readCleartextMessage({ cleartextMessage: text });
    const key = await openpgp__rspack_import_0.readKey({ armoredKey: signer });
    const verification = await openpgp__rspack_import_0.verify({
        message,
        verificationKeys: key
    });
    await verification.signatures[0].verified;
    return message.getText();
}


},
"./lib/correxit/state.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  LIMIT: () => (LIMIT),
  cache: () => (cache),
  cell: () => (cell),
  cursor: () => (cursor),
  refresh: () => (refresh),
  refreshed: () => (refreshed),
  report: () => (report),
  workbook: () => (workbook)
});
/* import */ var _lumino_signaling__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@lumino/signaling");
/* import */ var _lumino_signaling__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_lumino_signaling__rspack_import_0);
/* import */ var ___rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/rubric.js");


const signal = new _lumino_signaling__rspack_import_0.Signal({});
const guard = ({ content: notebook }) => {
    if (notebook.notebookConfig.showEditorForReadOnlyMarkdown !== false) {
        notebook.notebookConfig = {
            ...notebook.notebookConfig,
            showEditorForReadOnlyMarkdown: false
        };
    }
};
const state = { cursor: null, report: new Map(), workbook: null };
/** Upper bound for in-memory cache of cell scores. */
const LIMIT = 500;
/** Notifies that the UI needs to be refreshed. */
const refreshed = signal;
/**
 * Caches a cell score in memory.
 *
 * #### Notes
 * Enables UI components to display correction results (e.g., cell decorations)
 * across re-renders and tab switches. For locked workbooks, this is the only
 * storage mechanism since scores cannot be persisted to rubric metadata.
 */
function cache(workbook, id, score) {
    const rubric = ___rspack_import_1.Workbook.open(workbook, true);
    if (!rubric)
        return;
    const key = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
    if (!state.report.has(key) && state.report.size >= LIMIT)
        state.report.delete(state.report.keys().next().value); // FIFO eviction
    state.report.set(key, score);
}
/** @returns the resolved cell id from command arguments. */
function cell(args) {
    var _a;
    const active = workbook();
    const notebook = ___rspack_import_1.Workbook.headed(active) ? active.content : null;
    const toolbar = args[___rspack_import_2.Rubric.Cell.TOOLBAR];
    return args.id || (toolbar && ((_a = notebook === null || notebook === void 0 ? void 0 : notebook.activeCell) === null || _a === void 0 ? void 0 : _a.model.id)) || '';
}
/** @returns the active reviewer cursor cell ID; caches the update if given. */
function cursor(update) {
    if (update !== undefined && update !== state.cursor) {
        state.cursor = update;
        refresh();
    }
    return state.cursor;
}
/** Notify the sidebar to re-render. */
function refresh() {
    signal.emit(undefined);
}
/** @returns the cached or persisted score for a cell. */
function report(workbook, id) {
    const rubric = ___rspack_import_1.Workbook.open(workbook, true);
    if (!rubric || !workbook)
        return null;
    const key = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
    const cached = state.report.get(key);
    if (cached)
        return cached;
    const score = ___rspack_import_2.Rubric.Score.resolve(rubric.assignment.report, id);
    if (score)
        cache(workbook, id, score);
    return score;
}
/** @returns the active workbook; caches the update if given. */
function workbook(update) {
    state.workbook = update === undefined ? state.workbook : update;
    const active = state.workbook;
    if (___rspack_import_1.Workbook.headed(active))
        guard(active);
    return state.workbook;
}


},
"./lib/correxit/submitters.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  manual: () => (manual)
});
/* import */ var ___rspack_import_0 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _security__rspack_import_1 = __webpack_require__("./lib/correxit/security.js");


/** Content-addressed digest receipt for a submitted workbook. */
async function manual(workbook, identifier) {
    var _a;
    const { assignee, issue, rubric: id } = identifier;
    const rubric = ___rspack_import_0.Workbook.open(workbook, true);
    const submission = (_a = rubric === null || rubric === void 0 ? void 0 : rubric.assignment.submission) !== null && _a !== void 0 ? _a : null;
    const notebook = workbook.context.model.sharedModel.toJSON();
    const collapse = ({ id, source }) => [id, Array.isArray(source) ? source.join('') : source];
    const sources = notebook.cells
        .map(collapse).sort(([a], [b]) => String(a).localeCompare(String(b)));
    const payload = JSON.stringify({
        assignee, issue, rubric: id, sources, submission
    });
    return `manual:${await _security__rspack_import_1.digest(payload)}`;
}


},
"./lib/correxit/unlocker.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Unlocker: () => (Unlocker)
});
/* import */ var ___rspack_import_0 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _input__rspack_import_3 = __webpack_require__("./lib/correxit/input.js");
/* import */ var _security__rspack_import_2 = __webpack_require__("./lib/correxit/security.js");



var Unlocker;
(function (Unlocker) {
    async function store(id, key, secrets) {
        const { manager, token } = secrets;
        const secret = { namespace: ___rspack_import_0.Correxit.UNLOCKER, id, value: key };
        await manager.set(token, ___rspack_import_0.Correxit.UNLOCKER, id, secret);
    }
    Unlocker.store = store;
    /**
     * Unlock a workbook trying, in order:
     * - the key, if provided as an argument
     * - the secrets manager, if available
     * - the given passphrase, if provided
     * - cached passphrases from previous successful unlocks
     * - a user prompt (deduplicated across concurrent calls)
     */
    async function unlock(workbook, credentials, secrets, trans) {
        const rubric = ___rspack_import_1.Workbook.open(workbook, true);
        if (!rubric)
            return null;
        const { id } = rubric;
        if (rubric.key) {
            await store(id, rubric.key, secrets);
            return attempt(workbook, rubric.key);
        }
        const handle = ___rspack_import_1.Workbook.Credentials.normalize(credentials);
        const unlocked = await resolve(workbook, id, handle, secrets);
        if (unlocked || (credentials === null || credentials === void 0 ? void 0 : credentials.silent))
            return unlocked;
        return inquire(workbook, id, secrets, trans);
    }
    Unlocker.unlock = unlock;
})(Unlocker || (Unlocker = {}));
/** Attempt to unlock a workbook with the given key. */
async function attempt(workbook, key) {
    return ___rspack_import_1.Workbook.unlock(workbook, key);
}
/** Yields candidate keys in priority order without user interaction. */
async function* candidates(id, handle, secrets) {
    if (handle === null || handle === void 0 ? void 0 : handle.key)
        yield handle.key;
    const { manager, token } = secrets;
    const stored = await manager.get(token, ___rspack_import_0.Correxit.UNLOCKER, id);
    if (stored === null || stored === void 0 ? void 0 : stored.value)
        yield stored.value;
    if (handle === null || handle === void 0 ? void 0 : handle.passphrase)
        yield await _security__rspack_import_2.keygen(handle.passphrase, id);
    for (const passphrase of secrets.passphrases)
        yield await _security__rspack_import_2.keygen(passphrase, id);
}
/**
 * Prompts the user for a passphrase (deduplicated across concurrent calls).
 * The in-flight `pending` promise is shared so parallel callers join the same
 * dialog; it is cleared as soon as the dialog settles regardless of outcome.
 */
async function inquire(workbook, id, secrets, trans) {
    const pending = secrets.pending || prompt(workbook, trans);
    secrets.pending = pending;
    const passphrase = await pending;
    if (secrets.pending === pending)
        secrets.pending = null;
    if (!passphrase)
        return null;
    secrets.passphrases.add(passphrase);
    const key = await _security__rspack_import_2.keygen(passphrase, id);
    const unlocked = await attempt(workbook, key);
    await Unlocker.store(id, key, secrets);
    return unlocked;
}
/** Prompt the user for a passphrase. */
async function prompt(workbook, trans) {
    const { path } = workbook.context;
    return _input__rspack_import_3.text({
        title: trans.__('Enter passphrase to unlock'),
        label: trans.__('Enter passphrase for %1', path)
    });
}
/** Iterates candidate keys, returning on first successful unlock. */
async function resolve(workbook, id, handle, secrets) {
    for await (const key of candidates(id, handle, secrets)) {
        try {
            const unlocked = await attempt(workbook, key);
            await Unlocker.store(id, key, secrets);
            return unlocked;
        }
        catch (_a) {
            continue;
        }
    }
    return null;
}


},
"./lib/correxit/use-command.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  useCommand: () => (useCommand)
});
/* import */ var _lumino_polling__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@lumino/polling");
/* import */ var _lumino_polling__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_lumino_polling__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);


/**
 * Executes a command that yields an async iterable and streams its results into
 * a state array in a component.
 *
 * @template T - the type of items yielded by the command.
 * @param commands - the application command registry.
 * @param id - the ID of the command to execute.
 * @param args - the arguments passed to the command.
 * @returns a tuple containing the accumulating list of items and an `idle` flag
 * indicating whether the command has completed.
 *
 * #### Notes
 * This hook bridges the gap between imperative async generators and declarative
 * React UI, enabling real-time visualization of "streaming" data. The consuming
 * component should use memoization to render efficiently.
 *
 * Command streams restart when `id` or serialized `args` changes.
 * Cleanup marks the prior stream interrupted and drops subsequent emissions.
 *
 * State updates are buffered and throttled to ~60fps (16ms).
 */
function useCommand(commands, id, args) {
    const [state, setState] = (0,react__rspack_import_1.useState)({ idle: true, list: [] });
    // Object identity is deliberately ignored: serialized arguments define
    // when a command stream restarts. See DEBT.md for the planned extraction.
    /* eslint-disable react-hooks/exhaustive-deps */
    (0,react__rspack_import_1.useEffect)((interrupted = false) => {
        (async (stream) => {
            const buffer = [];
            const flush = () => {
                if (buffer.length) {
                    const chunk = buffer.slice();
                    buffer.length = 0;
                    setState(({ list }) => ({ idle: false, list: [...list, ...chunk] }));
                }
            };
            const throttler = new _lumino_polling__rspack_import_0.Throttler(flush, { limit: 16 });
            setState({ idle: false, list: [] });
            try {
                for await (const item of await (stream || [])) {
                    if (interrupted)
                        return;
                    buffer.push(item);
                    void throttler.invoke();
                }
                flush();
            }
            finally {
                throttler.dispose();
                if (!interrupted)
                    setState(({ list }) => ({ idle: true, list }));
            }
        })(commands.hasCommand(id) ? commands.execute(id, args) : undefined);
        return () => void (interrupted = true);
    }, [id, JSON.stringify(args)]);
    /* eslint-enable react-hooks/exhaustive-deps */
    return [state.list, state.idle];
}


},
"./lib/correxit/workbook.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Workbook: () => (Workbook)
});
/* import */ var _jupyterlab_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/coreutils");
/* import */ var _jupyterlab_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__rspack_import_0);
/* import */ var _jupyterlab_notebook__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/notebook");
/* import */ var _jupyterlab_notebook__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__rspack_import_1);
/* import */ var _lumino_algorithm__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@lumino/algorithm");
/* import */ var _lumino_algorithm__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_lumino_algorithm__rspack_import_2);
/* import */ var ___rspack_import_5 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_7 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _certificate__rspack_import_6 = __webpack_require__("./lib/correxit/certificate.js");
/* import */ var _error__rspack_import_3 = __webpack_require__("./lib/correxit/error.js");
/* import */ var _kernels__rspack_import_9 = __webpack_require__("./lib/correxit/kernels.js");
/* import */ var _security__rspack_import_4 = __webpack_require__("./lib/correxit/security.js");
/* import */ var _state__rspack_import_8 = __webpack_require__("./lib/correxit/state.js");









/** Notebook state, identity, lifecycle, and grading operations. */
var Workbook;
(function (Workbook) {
    let Credentials;
    (function (Credentials) {
        function normalize(credentials) {
            const { key, passphrase, path, unlock } = credentials || {};
            if (key && unlock || !path)
                return null;
            return {
                path,
                key: key || null,
                passphrase: key ? null : passphrase || null,
                unlock: unlock || null
            };
        }
        Credentials.normalize = normalize;
    })(Credentials = Workbook.Credentials || (Workbook.Credentials = {}));
    /** Type guard for workbooks with a live notebook widget. */
    function headed(workbook) {
        return !!(workbook === null || workbook === void 0 ? void 0 : workbook.content);
    }
    Workbook.headed = headed;
    /** Type guard for workbooks without a live notebook widget. */
    function headless(workbook) {
        return !!workbook && workbook.content === null;
    }
    Workbook.headless = headless;
    let Identifier;
    (function (Identifier) {
        /** Type guard for assigned identifiers. */
        function assigned(id) {
            return id.assignee !== null && id.file !== null;
        }
        Identifier.assigned = assigned;
    })(Identifier = Workbook.Identifier || (Workbook.Identifier = {}));
    let Cell;
    (function (Cell) {
        /** Returns a prepared decrypted cell replacement. */
        async function decrypt(workbook, reference, key) {
            const notebook = workbook.context.model.sharedModel;
            const index = (0,_lumino_algorithm__rspack_import_2.findIndex)(notebook.cells, ({ id }) => id === reference);
            if (!key || index === -1)
                throw new _error__rspack_import_3.Decrypt('decrypt error');
            const cell = notebook.cells[index];
            const source = await _security__rspack_import_4.decrypt(cell.getSource(), key);
            const jupyter = { ...(cell.getMetadata('jupyter') || {}) };
            delete jupyter['source_hidden'];
            const snapshot = cell.toJSON();
            const metadata = { ...snapshot.metadata, jupyter, trusted: true };
            delete metadata['editable'];
            const replacement = { ...snapshot, cell_type: 'code', metadata, source };
            return { index, replacement };
        }
        Cell.decrypt = decrypt;
        /**
         * Prepares an encrypted cell replacement.
         *
         * @returns cell index and encrypted JSON with `cell_type` set to `'raw'`.
         */
        async function encrypt(workbook, reference, key) {
            const notebook = workbook.context.model.sharedModel;
            const index = (0,_lumino_algorithm__rspack_import_2.findIndex)(notebook.cells, ({ id }) => id === reference);
            if (!key || index === -1)
                throw new _error__rspack_import_3.Encrypt('encrypt error');
            const cell = notebook.cells[index];
            const source = await _security__rspack_import_4.encrypt(cell.getSource(), key);
            const jupyter = {
                ...(cell.getMetadata('jupyter') || {}),
                source_hidden: true
            };
            const snapshot = cell.toJSON();
            const metadata = { ...snapshot.metadata, editable: false, jupyter };
            delete metadata['trusted'];
            const replacement = { ...snapshot, cell_type: 'raw', metadata, source };
            return { index, replacement };
        }
        Cell.encrypt = encrypt;
        /** Prepares a PGP-sealed cell replacement (any type -> raw). */
        async function seal(workbook, id, assignee, recipients) {
            const notebook = workbook.context.model.sharedModel;
            const index = (0,_lumino_algorithm__rspack_import_2.findIndex)(notebook.cells, cell => cell.id === id);
            if (index === -1)
                throw new _error__rspack_import_3.Seal('seal error: cell not found');
            const cell = notebook.cells[index];
            const type = cell.toJSON().cell_type;
            const source = cell.getSource();
            const payload = JSON.stringify({ assignee, id, source, type });
            const ciphertext = await _security__rspack_import_4.seal(payload, recipients);
            const jupyter = {
                ...(cell.getMetadata('jupyter') || {}),
                source_hidden: true
            };
            const snapshot = cell.toJSON();
            const metadata = { ...snapshot.metadata, editable: false, jupyter };
            delete metadata['trusted'];
            const replacement = {
                ...snapshot, cell_type: 'raw', metadata, source: ciphertext
            };
            return { index, replacement };
        }
        Cell.seal = seal;
        /** Prepares an unsealed cell replacement (raw -> original type). */
        async function unseal(workbook, id, assignee, key) {
            const notebook = workbook.context.model.sharedModel;
            const index = (0,_lumino_algorithm__rspack_import_2.findIndex)(notebook.cells, cell => cell.id === id);
            if (index === -1)
                throw new _error__rspack_import_3.Unseal('unseal error: cell not found');
            const cell = notebook.cells[index];
            const json = await _security__rspack_import_4.unseal(cell.getSource(), key);
            const payload = JSON.parse(json);
            if (payload.assignee !== assignee) {
                throw new _error__rspack_import_3.Mismatch(`assignee mismatch: ${assignee} ≠ ${payload.assignee}`);
            }
            if (payload.id !== id)
                throw new _error__rspack_import_3.Mismatch('cell id mismatch: sealed cell was moved');
            const jupyter = { ...(cell.getMetadata('jupyter') || {}) };
            delete jupyter['source_hidden'];
            const snapshot = cell.toJSON();
            const metadata = { ...snapshot.metadata, jupyter };
            delete metadata['editable'];
            const replacement = {
                ...snapshot, cell_type: payload.type, metadata, source: payload.source
            };
            return { index, replacement };
        }
        Cell.unseal = unseal;
    })(Cell = Workbook.Cell || (Workbook.Cell = {}));
    const quiet = true;
    const defrost = (workbook) => {
        const notebook = workbook.context.model.sharedModel;
        for (const cell of notebook.cells) {
            const jupyter = cell.getMetadata('jupyter');
            if (jupyter === null || jupyter === void 0 ? void 0 : jupyter.source_hidden)
                continue;
            cell.transact(() => cell.deleteMetadata('editable'));
        }
    };
    const freeze = (workbook) => {
        const notebook = workbook.context.model.sharedModel;
        for (const cell of notebook.cells)
            cell.transact(() => cell.setMetadata('editable', false));
    };
    const [get, set] = (pool => {
        const get = (workbook) => pool.get(workbook) || null;
        const set = (workbook, rubric) => pool.set(workbook, rubric).has(workbook);
        return [get, set];
    })(new WeakMap());
    const stale = (assignment, { assignee = assignment.assignee, expiration = assignment.expiration, id = assignment.id, issue = assignment.issue, issuer = assignment.issuer, mac = assignment.mac, name = assignment.name, overdue = assignment.overdue, penalty = assignment.penalty, resources = assignment.resources, submission = assignment.submission, submitted = assignment.submitted, roster = assignment.roster, }) => (assignee !== assignment.assignee ||
        expiration !== assignment.expiration ||
        id !== assignment.id ||
        issue !== assignment.issue ||
        issuer !== assignment.issuer ||
        mac !== assignment.mac ||
        name !== assignment.name ||
        overdue !== assignment.overdue ||
        penalty !== assignment.penalty ||
        !___rspack_import_5.Rubric.Assignment.Equal.resources({ resources }, assignment) ||
        submission !== assignment.submission ||
        submitted !== assignment.submitted ||
        (roster !== assignment.roster &&
            (roster.length !== assignment.roster.length ||
                roster.some((record, i) => record !== assignment.roster[i]))) ||
        false);
    const transact = (workbook, prepared) => {
        if (!prepared.length)
            return;
        const notebook = workbook.context.model.sharedModel;
        notebook.transact(() => {
            for (const { index, replacement } of prepared) {
                notebook.deleteCell(index);
                notebook.insertCell(index, replacement);
            }
        }, false);
        if (headed(workbook))
            _jupyterlab_notebook__rspack_import_1.NotebookActions.deselectAll(workbook.content);
    };
    const sequence = (rubric) => Object.keys(rubric.cells).sort();
    const digest = (ciphertexts) => _security__rspack_import_4.digest(ciphertexts.join('\n'));
    const verify = async (workbook, rubric, action) => {
        const { seal } = rubric.assignment;
        if (!seal)
            return [];
        const ids = sequence(rubric);
        const { cells } = workbook.context.model.sharedModel;
        const indices = Object.fromEntries(cells.map(cell => [cell.id, cell]));
        const present = ids.filter(id => id in indices);
        const missing = ids.filter(id => !(id in indices));
        if (missing.length) {
            if (headless(workbook))
                throw new _error__rspack_import_3.Unseal(`${action} seal error: missing cells`);
            console.warn(`${action}: skipping seal verify, missing cells`, missing);
            return present;
        }
        const ciphertexts = present.map(id => indices[id].getSource());
        const hash = await digest(ciphertexts);
        if (hash !== seal)
            throw new _error__rspack_import_3.Mismatch('seal mismatch: ciphertexts tampered');
        return present;
    };
    const forensic = (metadata) => {
        const root = record(metadata) ? metadata : null;
        const assignment = root && record(root.assignment) ? root.assignment : null;
        const keys = assignment && record(assignment.keys)
            ? {
                private: record(assignment.keys.private)
                    ? assignment.keys.private
                    : null
            }
            : null;
        return {
            assignment,
            assignee: text(assignment === null || assignment === void 0 ? void 0 : assignment.assignee),
            id: text(root === null || root === void 0 ? void 0 : root.id),
            keys
        };
    };
    const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
    const rescue = async (field, key, recipients) => {
        const armored = text(field);
        if (!armored)
            return;
        try {
            const decrypted = await _security__rspack_import_4.decrypt(armored, key);
            if (decrypted !== armored)
                recipients.push(await _security__rspack_import_4.parse(decrypted));
        }
        catch ( /* wrong key or corrupt */_a) { /* wrong key or corrupt */ }
    };
    const reveal = async (source, key, recipients) => {
        try {
            const decrypted = await _security__rspack_import_4.decrypt(source, key);
            if (decrypted !== source)
                return { payload: null, recovered: decrypted };
        }
        catch ( /* wrong key */_a) { /* wrong key */ }
        for (const recipient of recipients) {
            try {
                const json = await _security__rspack_import_4.unseal(source, recipient);
                const decoded = JSON.parse(json);
                return {
                    payload: record(decoded) ? decoded : null,
                    recovered: null
                };
            }
            catch ( /* wrong key or not sealed to this recipient */_b) { /* wrong key or not sealed to this recipient */ }
        }
        return { payload: null, recovered: null };
    };
    const text = (value) => typeof value === 'string' ? value : null;
    /** Add a cell to a workbook's rubric. */
    async function add(workbook, cell, references = []) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('add error, invalid rubric');
        return update(workbook, ___rspack_import_5.Rubric.add(rubric, cell, references));
    }
    Workbook.add = add;
    /** Acknowledge a submitted workbook grade with a receipt. */
    async function acknowledge(workbook, receipt = null) {
        const rubric = open(workbook, quiet);
        if (!rubric || !rubric.locked || !rubric.assignment.submission)
            throw new _error__rspack_import_3.Submit('acknowledge error');
        return update(workbook, ___rspack_import_5.Rubric.acknowledge(rubric, receipt));
    }
    Workbook.acknowledge = acknowledge;
    /**
     * Update a workbook's assignment metadata.
     *
     * @param workbook - the workbook to update.
     * @param assignment - the partial assignment data to apply.
     *
     * #### Notes
     * Fields that are `undefined` in the `assignment` argument are ignored, i.e.,
     * the existing values in the rubric are preserved.
     *
     * Fields that are `null` (where allowed, e.g. `expiration`) will explicitly
     * clear the value in the rubric.
     */
    async function assign(workbook, assignment = {}) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('assign error');
        return stale(rubric.assignment, assignment)
            ? update(workbook, await ___rspack_import_5.Rubric.assign(rubric, assignment))
            : rubric;
    }
    Workbook.assign = assign;
    /**
     * Audits a workbook's rubric, pruning impossible cells and references.
     * Never throws.
     *
     * #### Notes
     * If the rubric is locked, it is left unmodified.
     *
     * Headed workbooks repair missing notebook state when possible: orphaned
     * references are removed, and cells left invalid or unscorable are dropped.
     * Headless workbooks fail immediately. Batch grading cannot recover from
     * a structurally incomplete notebook.
     */
    function audit(workbook, rubric) {
        if (!rubric)
            return { ok: false, error: 'null rubric', rubric };
        if (rubric.locked)
            return { ok: true, rubric };
        const notebook = workbook.context.model.sharedModel;
        const types = Object.fromEntries(notebook.cells.map(cell => [cell.id, cell.cell_type]));
        const orphaned = [];
        const dangling = [];
        const executable = (id) => types[id] === 'code' || types[id] === 'raw';
        for (const id in rubric.cells) {
            const cell = rubric.cells[id];
            const { is, payload } = cell;
            const present = is === 'reviewable' ? id in types : executable(id);
            const valid = is === 'answerable' ? !!payload.length : true;
            if (!present || !valid) {
                const reason = id in types ? 'invalid cell' : 'unknown cell';
                dangling.push({ cell: { ...cell }, reason });
                continue;
            }
            const references = Object.values(rubric.references)
                .filter(reference => reference.cell === id);
            orphaned.push(...references
                .filter(reference => !executable(reference.referent))
                .map(reference => reference.referent));
        }
        if (dangling.length || orphaned.length) {
            if (dangling.length)
                console.warn('audit pruned these rubric cells', dangling);
            if (orphaned.length)
                console.warn('audit pruned these references', orphaned);
            if (headless(workbook)) {
                const error = dangling.length ? 'missing cells' : 'missing references';
                return { ok: false, error, rubric };
            }
            const dereferenced = orphaned.reduce((unlocked, referent) => ___rspack_import_5.Rubric.dereference(unlocked, referent), rubric);
            const scrubbed = dangling.reduce((unlocked, { cell: { id } }) => ___rspack_import_5.Rubric.remove(unlocked, id), dereferenced);
            return { ok: true, rubric: scrubbed };
        }
        return { ok: true, rubric };
    }
    Workbook.audit = audit;
    /** Collect a certified workbook grade. */
    async function collect(workbook, receipt = null) {
        const rubric = open(workbook, quiet);
        if (!rubric || !rubric.locked || !rubric.assignment.certification)
            throw new _error__rspack_import_3.Certify('collect error');
        return update(workbook, ___rspack_import_5.Rubric.collect(rubric, receipt));
    }
    Workbook.collect = collect;
    async function distribute(workbook) {
        const rubric = open(workbook, quiet);
        if (!rubric || !rubric.locked || !rubric.assignment.assignee)
            throw new _error__rspack_import_3.Invalid('distribute error');
        return update(workbook, ___rspack_import_5.Rubric.distribute(rubric));
    }
    Workbook.distribute = distribute;
    /**
     * Certify a workbook: correct, lock, and freeze.
     *
     * When `bypass` is true, skip kernel re-execution and build the grade
     * from the existing report scores. Use this when all cells have already
     * been graded and reviewed (e.g. after the last manual intervention).
     */
    async function certify(workbook, trans, bypass = false) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Certify('certify error');
        if (___rspack_import_5.Rubric.pending(rubric))
            throw new _error__rspack_import_3.Certify('certify error: pending review');
        const identifier = Workbook.identifier(workbook);
        if (!Identifier.assigned(identifier))
            throw new _error__rspack_import_3.Certify('certify error: unassigned');
        if (___rspack_import_5.Rubric.Assignment.rejected(rubric.assignment))
            throw new _error__rspack_import_3.Certify('certify error: overdue rejected');
        let grade;
        if (bypass) {
            const { report } = rubric.assignment;
            const score = ___rspack_import_5.Rubric.Assignment.summary(report, rubric.assignment);
            const cells = Object.values(rubric.cells);
            const ungraded = cells.some(cell => cell.is !== 'reviewable' &&
                (!report.scores[cell.id] ||
                    report.scores[cell.id].status === 'unscored'));
            const resolved = !ungraded && score.status !== 'unscored';
            const { path } = workbook.context;
            grade = { path, resolved, score, spec: report.kernel };
        }
        else {
            grade = await correct(workbook);
        }
        if (!grade.resolved) {
            throw new _error__rspack_import_3.Certify(`certify error: unresolved: (${grade.score.status})`);
        }
        const scored = open(workbook, quiet);
        if (!scored || scored.locked)
            throw new _error__rspack_import_3.Certify('certify error');
        await update(workbook, ___rspack_import_5.Rubric.certify(scored));
        await lock(workbook);
        _certificate__rspack_import_6.render(workbook, grade, trans);
        freeze(workbook);
        return { grade, identifier, workbook };
    }
    Workbook.certify = certify;
    /** Convert a plain notebook into a workbook and return its rubric. */
    async function convert(workbook, passphrase, unlocker) {
        try {
            const opened = open(workbook);
            const key = await _security__rspack_import_4.keygen(passphrase, opened.id);
            const rubric = opened.locked ? await ___rspack_import_5.Rubric.unlock(opened, key) : opened;
            return update(workbook, rubric);
        }
        catch (error) {
            if (error !== ___rspack_import_7.Correxit.NO_CORREXIT_METADATA)
                throw error;
            const model = workbook.context.model;
            if (model.nbformatMinor < 5) {
                // Ensure nbformat 4.5 so cell IDs persist on save.
                const notebook = model.toJSON();
                notebook.nbformat_minor = 5;
                model.fromJSON(notebook);
            }
            const created = ___rspack_import_5.Rubric.create();
            const key = await _security__rspack_import_4.keygen(passphrase, created.id);
            const pair = await _security__rspack_import_4.keypair();
            const armored = await _security__rspack_import_4.encrypt(pair.private, key);
            const keys = {
                private: { assignee: null, author: armored },
                public: { assignee: null, author: pair.public }
            };
            const assignment = { ...created.assignment, keys };
            unlocker.store(created.id, key);
            return update(workbook, { ...created, assignment, key });
        }
    }
    Workbook.convert = convert;
    async function correct(workbook, id, verbose) {
        const path = workbook.context.path;
        const opened = open(workbook, quiet);
        const empty = new Map();
        const expand = (grade, outputs) => verbose ? { ...grade, outputs } : grade;
        if (!opened) {
            const score = { ...___rspack_import_5.Rubric.Score.UNSCORED, code: 'missing-rubric' };
            return expand({ path, resolved: false, score, spec: null }, empty);
        }
        // Re-audit to get the repaired rubric: headed workbooks remove
        // orphaned references and drop impossible cells, headless ones fail.
        const audited = audit(workbook, opened);
        if (!audited.ok) {
            const score = { ...___rspack_import_5.Rubric.Score.UNSCORED, comment: audited.error };
            return expand({ path, resolved: false, score, spec: null }, empty);
        }
        const rubric = audited.rubric;
        const reviewable = ({ is }) => is === 'reviewable';
        const cells = Object.values(rubric.cells);
        const target = id ? ___rspack_import_5.Rubric.get(rubric, id) : null;
        const manual = target
            ? target.is === 'reviewable'
            : cells.length > 0 && cells.every(reviewable);
        const result = manual
            ? { spec: null, outputs: new Map() }
            : await execute(workbook, rubric, id);
        if (!result) {
            const score = { ...___rspack_import_5.Rubric.Score.UNSCORED, code: 'error-execute' };
            return expand({ path, resolved: false, score, spec: null }, empty);
        }
        const { score, summary } = ___rspack_import_5.Rubric.Assignment;
        const { outputs, spec } = result;
        const report = { ...await score(rubric, outputs, id), kernel: spec };
        const scored = Object.entries(report.scores);
        scored.forEach(([id, score]) => _state__rspack_import_8.cache(workbook, id, score));
        const final = id ? report.scores[id] : summary(report, rubric.assignment);
        const missing = ({ id, is, references }) => {
            if (is === 'reviewable')
                return false;
            return !outputs.has(id) ||
                ((is === 'comparable' || is === 'correctable')
                    && references
                    ? references.some(referent => !outputs.has(referent))
                    : false);
        };
        const unresolved = (cell) => {
            const { status } = report.scores[cell.id] || {};
            return cell.is !== 'reviewable' && (!status || status === 'unscored');
        };
        const resolved = id
            ? final.status !== 'unscored'
            : !cells.some(missing) && !cells.some(unresolved);
        if (resolved && !rubric.locked)
            await update(workbook, await ___rspack_import_5.Rubric.sign(rubric, report));
        return expand({ path, resolved, score: final, spec }, outputs);
    }
    Workbook.correct = correct;
    /**
    * Adds a comment to a cell in the assignment score report.
    *
    * @param workbook - the workbook to modify the report for.
    * @param id - the id of the cell to add comment for.
    *
    * @returns a promise that resolves when the workbook has been updated.
    */
    async function comment(workbook, id, comment) {
        var _a;
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            return null;
        const { report: kept } = rubric.assignment;
        const score = (_a = kept.scores[id]) !== null && _a !== void 0 ? _a : { ...___rspack_import_5.Rubric.Score.UNSCORED, id };
        const scores = { ...kept.scores, [id]: { ...score, comment } };
        const signed = await ___rspack_import_5.Rubric.sign(rubric, { ...kept, scores });
        return update(workbook, signed);
    }
    Workbook.comment = comment;
    /** Decrypts workbook content. */
    async function decrypt(workbook, rubric) {
        const audited = Workbook.audit(workbook, rubric);
        if (!audited.ok)
            throw new _error__rspack_import_3.Decrypt(`decrypt error: ${audited.error}`);
        const { key, references } = audited.rubric;
        const secrets = Object.values(references).filter(({ secret }) => secret);
        const prepared = await Promise.all(secrets.map(({ referent }) => Cell.decrypt(workbook, referent, key)));
        transact(workbook, prepared);
        defrost(workbook);
        // Keep the original rubric. Decrypt should not persist audit repairs.
        return update(workbook, rubric, { ok: true, rubric });
    }
    Workbook.decrypt = decrypt;
    /** Remove a single reference from a cell. */
    function dereference(workbook, referent) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('dereference error, invalid rubric');
        update(workbook, ___rspack_import_5.Rubric.dereference(rubric, referent));
    }
    Workbook.dereference = dereference;
    /** Revert a submission to draft, restoring cell editability. */
    async function draft(workbook) {
        const rubric = open(workbook, quiet);
        if (!(rubric === null || rubric === void 0 ? void 0 : rubric.locked) || !rubric.assignment.submission)
            throw new _error__rspack_import_3.Submit('draft error');
        defrost(workbook);
        return update(workbook, ___rspack_import_5.Rubric.draft(rubric));
    }
    Workbook.draft = draft;
    /**
     * Executes the code cells of a workbook.
     *
     * @param workbook - the workbook to run.
     * @param id - the ID of the target cell.
     *
     * @returns a promise that resolves to a collection of executed cell outputs.
     *
     * #### Notes
     * If `id` is not provided, the whole workbook is executed.
     * If `id` is provided and the target cell is 'answerable', the workbook is
     * executed up to this cell.
     * If `id` is provided and the target cell is `comparable` or `correctable`,
     * the workbook is executed up to both target and reference cells.
     */
    async function execute(workbook, rubric, id) {
        const { execute } = ___rspack_import_5.Rubric.Cell;
        const { model: { cells } } = workbook.context;
        const position = (target) => 1 + (0,_lumino_algorithm__rspack_import_2.findIndex)(cells, ({ id }) => id === target);
        const scan = (cell) => cell.is === 'correctable' || cell.is === 'comparable'
            ? Math.max(position(cell.id), ...cell.references.map(position))
            : position(cell.id);
        const cell = id && ___rspack_import_5.Rubric.get(rubric, id);
        if (id && !cell)
            return null;
        const outputs = new Map();
        const leased = await _kernels__rspack_import_9.lease(workbook);
        if (!leased)
            return null;
        const [kernel, release] = leased;
        try {
            const spec = await kernel.spec || null;
            for (const index of (0,_lumino_algorithm__rspack_import_2.range)(cell ? scan(cell) : cells.length)) {
                const cell = cells.get(index);
                if (!cell || cell.type !== 'code')
                    continue;
                try {
                    outputs.set(cell.id, await execute(cell, kernel));
                }
                catch (error) {
                    console.warn('cell execute error', cell, error);
                }
            }
            return { outputs, spec };
        }
        finally {
            void release();
        }
    }
    Workbook.execute = execute;
    function identifier(workbook) {
        const rubric = open(workbook, quiet);
        if (!rubric)
            throw new _error__rspack_import_3.Invalid('identifier error');
        const assignee = rubric.assignment.assignee || null;
        const assignment = rubric.assignment.id;
        const file = _jupyterlab_coreutils__rspack_import_0.PathExt.basename(workbook.context.path) || null;
        const issue = rubric.assignment.issue || null;
        return { assignee, assignment, file, issue, rubric: rubric.id };
    }
    Workbook.identifier = identifier;
    /** Lock a workbook if its rubric is unlocked. */
    async function lock(workbook) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            return;
        const audited = audit(workbook, rubric);
        if (!audited.ok)
            throw new _error__rspack_import_3.Invalid(`lock error: ${audited.error}`);
        const valid = audited.rubric;
        const locked = await ___rspack_import_5.Rubric.lock(valid);
        const { key, references } = valid;
        const secrets = Object.values(references).filter(({ secret }) => secret);
        const prepared = await Promise.all(secrets.map(({ referent }) => Cell.encrypt(workbook, referent, key)));
        transact(workbook, prepared);
        update(workbook, locked, { ok: true, rubric: locked });
    }
    Workbook.lock = lock;
    /**
     * Intervenes with a manual score for a cell.
     *
     * @param workbook - the workbook to modify the report for.
     * @param id - the id of the cell to intervene on.
     * @param intervention - the manual score intervention.
     *
     * @returns a promise that resolves when the workbook has been updated.
     */
    async function intervene(workbook, id, intervention) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            return null;
        const { report: kept } = rubric.assignment;
        const interventions = { ...kept.interventions };
        if (intervention)
            interventions[id] = intervention;
        else
            delete interventions[id];
        const report = { ...kept, interventions };
        return update(workbook, await ___rspack_import_5.Rubric.sign(rubric, report));
    }
    Workbook.intervene = intervene;
    /**
     * Synchronously returns a workbook's rubric or `null` from notebook metadata.
     *
     * @param workbook - The current workbook. May be `null`.
     * @param quiet - Whether to return `null` or throw errors.
     *
     * #### Notes
     * If a rubric exists in the pool for the given workbook, it is returned.
     *
     * If no rubric exists in the pool for the given workbook, its notebook
     * metadata for the key `correxit` is read, parsed, normalized, and audited.
     * Each of these steps may throw an error or return null.
     * @see update
     */
    function open(workbook, quiet = false) {
        if (!workbook) {
            if (quiet)
                return null;
            throw new _error__rspack_import_3.Invalid('open error');
        }
        if (get(workbook))
            return get(workbook);
        const notebook = workbook.context.model.sharedModel;
        const metadata = notebook.getMetadata('correxit');
        try {
            if (!metadata)
                throw ___rspack_import_7.Correxit.NO_CORREXIT_METADATA;
            const rubric = ___rspack_import_5.Rubric.normalize(metadata);
            const audit = Workbook.audit(workbook, rubric);
            if (!audit.ok)
                throw new _error__rspack_import_3.Invalid(`open error: ${audit.error}`);
            set(workbook, audit.rubric);
            return audit.rubric;
        }
        catch (error) {
            if (quiet)
                return null;
            throw error;
        }
    }
    Workbook.open = open;
    /** @returns provisioned recipient keys for a given workbook. */
    async function recipients(workbook, passphrase) {
        const rubric = open(workbook, quiet);
        if (!(rubric === null || rubric === void 0 ? void 0 : rubric.locked) || !rubric.assignment.assignee)
            throw new _error__rspack_import_3.Submit('recipients error');
        const { author } = rubric.assignment.keys.public;
        if (!passphrase)
            return [author];
        const secret = await _security__rspack_import_4.keygen(passphrase, rubric.id);
        const pair = await _security__rspack_import_4.keypair();
        const armored = await _security__rspack_import_4.encrypt(pair.private, secret);
        const keys = {
            private: { ...rubric.assignment.keys.private, assignee: armored },
            public: { ...rubric.assignment.keys.public, assignee: pair.public }
        };
        await update(workbook, ___rspack_import_5.Rubric.provision(rubric, keys));
        return [author, pair.public];
    }
    Workbook.recipients = recipients;
    /**
     * Attempt to decrypt all encrypted cells in a workbook.
     *
     * Reads the rubric ID and encrypted PGP keys directly from raw
     * notebook metadata (no normalization required). Tries symmetric
     * decryption and, if PGP private keys can be recovered, asymmetric
     * unsealing on every encrypted cell.
     *
     * @returns the number of cells successfully recovered.
     */
    async function recover(workbook, passphrase) {
        var _a, _b;
        const notebook = workbook.context.model.sharedModel;
        const { assignee, id, keys } = forensic(notebook.getMetadata('correxit'));
        if (!id)
            return 0;
        const key = await _security__rspack_import_4.keygen(passphrase, id);
        const recipients = [];
        const types = new Set(['code', 'markdown', 'raw']);
        const sanitize = ({ index, payload, replacement }) => {
            if (!payload)
                return [{ index, replacement }];
            if (payload.id !== notebook.cells[index].id)
                return [];
            if (typeof payload.source !== 'string')
                return [];
            if (typeof payload.type !== 'string' || !types.has(payload.type))
                return [];
            if (assignee && payload.assignee !== assignee)
                return [];
            return [{ index, replacement }];
        };
        await rescue((_a = keys === null || keys === void 0 ? void 0 : keys.private) === null || _a === void 0 ? void 0 : _a.author, key, recipients);
        await rescue((_b = keys === null || keys === void 0 ? void 0 : keys.private) === null || _b === void 0 ? void 0 : _b.assignee, key, recipients);
        const prepared = [];
        for (const [index, cell] of notebook.cells.entries()) {
            const source = cell.getSource();
            if (!_security__rspack_import_4.encrypted(source))
                continue;
            const { payload, recovered } = await reveal(source, key, recipients);
            if (!recovered && !payload)
                continue;
            const raw = cell.getMetadata('jupyter');
            const jupyter = record(raw) ? { ...raw } : {};
            delete jupyter['source_hidden'];
            const snapshot = cell.toJSON();
            const metadata = { ...snapshot.metadata, jupyter, trusted: true };
            delete metadata.editable;
            const cell_type = text(payload === null || payload === void 0 ? void 0 : payload.type) || 'code';
            const unsealed = text(payload === null || payload === void 0 ? void 0 : payload.source) || recovered;
            const replacement = {
                ...snapshot, cell_type, metadata, source: unsealed
            };
            prepared.push({ index, payload, replacement });
        }
        const sanitized = prepared.flatMap(sanitize);
        transact(workbook, sanitized);
        if (sanitized.length)
            defrost(workbook);
        return sanitized.length;
    }
    Workbook.recover = recover;
    /** Add a reference to an existing comparable or correctable cell. */
    async function refer(workbook, id, reference) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('refer error, invalid rubric');
        return update(workbook, ___rspack_import_5.Rubric.refer(rubric, id, reference));
    }
    Workbook.refer = refer;
    /** Remove a cell from a workbook's rubric. */
    function remove(workbook, id) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('remove error, invalid rubric');
        update(workbook, ___rspack_import_5.Rubric.remove(rubric, id));
    }
    Workbook.remove = remove;
    /**
     * Restore a workbook snapshot, invalidating cached rubric state first.
     *
     * Returns the restored rubric when the snapshot contains valid Correxit
     * metadata, otherwise `null`.
     */
    function restore(workbook, snapshot) {
        set(workbook, null);
        const model = workbook.context.model;
        model.fromJSON(snapshot);
        model.sharedModel.clearUndoHistory();
        return open(workbook, quiet);
    }
    Workbook.restore = restore;
    /** Reset a workbook back to a plain Jupyter notebook. */
    async function reset(workbook) {
        update(workbook, null);
    }
    Workbook.reset = reset;
    /** Revise a sealed submission: unseal cells and clear submission state. */
    async function revise(workbook, key) {
        const rubric = open(workbook, quiet);
        if (!(rubric === null || rubric === void 0 ? void 0 : rubric.locked) || !rubric.assignment.seal)
            throw new _error__rspack_import_3.Revise('revise error');
        const { assignee } = rubric.assignment;
        const ids = await verify(workbook, rubric, 'revise');
        const prepared = await Promise.all(ids.map(id => Cell.unseal(workbook, id, assignee, key)));
        transact(workbook, prepared);
        defrost(workbook);
        return update(workbook, ___rspack_import_5.Rubric.unseal(rubric));
    }
    Workbook.revise = revise;
    /** Update points for a cell or reference. */
    async function reweight(workbook, id, points) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('reweight error, invalid rubric');
        const updated = id in rubric.references
            ? ___rspack_import_5.Rubric.Reference.reweight(rubric, id, points)
            : ___rspack_import_5.Rubric.Cell.reweight(rubric, id, points);
        return update(workbook, updated);
    }
    Workbook.reweight = reweight;
    /**
     * Seal all rubric cells in a workbook, encrypting their sources
     * to the given PGP public key recipients.
     *
     * @returns the seal hash (SHA-256 of concatenated ciphertexts).
     */
    async function seal(workbook, rubric, recipients) {
        const { assignee } = rubric.assignment;
        const ids = sequence(rubric);
        const prepared = await Promise.all(ids.map(id => Cell.seal(workbook, id, assignee, recipients)));
        transact(workbook, prepared);
        const ciphertexts = prepared.map(({ replacement: { source } }) => Array.isArray(source) ? source.join('') : source);
        return digest(ciphertexts);
    }
    Workbook.seal = seal;
    /** Submit an assignment: seal rubric cells, then freeze. */
    async function submit(workbook, recipients) {
        const rubric = open(workbook, quiet);
        if (!(rubric === null || rubric === void 0 ? void 0 : rubric.locked))
            throw new _error__rspack_import_3.Submit('submit error');
        if (!recipients.length)
            throw new _error__rspack_import_3.Submit('submit error: missing seal recipients');
        const submission = Date.now();
        const assignment = { ...rubric.assignment, submission };
        if (___rspack_import_5.Rubric.Assignment.rejected(assignment))
            throw new _error__rspack_import_3.Submit('submit error: overdue rejected');
        const hash = await seal(workbook, rubric, recipients);
        const sealed = ___rspack_import_5.Rubric.seal(rubric, hash);
        freeze(workbook);
        return update(workbook, ___rspack_import_5.Rubric.submit(sealed, submission));
    }
    Workbook.submit = submit;
    /** Toggle a workbook reference's `secret` flag. */
    async function toggle(workbook, referent) {
        const rubric = open(workbook, quiet);
        if (!rubric || rubric.locked)
            throw new _error__rspack_import_3.Invalid('toggle error');
        return update(workbook, ___rspack_import_5.Rubric.toggle(rubric, referent));
    }
    Workbook.toggle = toggle;
    /** Unlocks a workbook's rubric and decrypts its contents. */
    async function unlock(workbook, key) {
        const rubric = open(workbook, quiet);
        if (!rubric)
            throw new _error__rspack_import_3.Unlock('unlock error');
        if (!rubric.locked)
            return rubric;
        let unlocked = await ___rspack_import_5.Rubric.unlock(rubric, key);
        const { assignment } = rubric;
        if (assignment.seal) {
            const armored = await _security__rspack_import_4.decrypt(assignment.keys.private.author, key);
            const author = await _security__rspack_import_4.parse(armored);
            const present = await verify(workbook, rubric, 'unlock');
            // Unseal each rubric cell present in the notebook.
            const { assignee } = assignment;
            const prepared = await Promise.all(present.map(id => Cell.unseal(workbook, id, assignee, author)));
            transact(workbook, prepared);
            // Clear the seal: cells are now plaintext, so the hash would not
            // match on a subsequent unlock after save-and-reopen.
            unlocked = {
                ...unlocked,
                assignment: { ...unlocked.assignment, seal: null }
            };
        }
        return decrypt(workbook, unlocked);
    }
    Workbook.unlock = unlock;
    /** @returns whether a workbook's assignment is started or not. */
    async function unstarted(workbook) {
        const rubric = open(workbook, quiet);
        if (!rubric)
            return false;
        const { unstarted } = ___rspack_import_5.Rubric.Assignment;
        const notebook = workbook.context.model.sharedModel.toJSON();
        return unstarted({ assignment: rubric.assignment, notebook, rubric });
    }
    Workbook.unstarted = unstarted;
    async function update(workbook, rubric, audited = audit(workbook, rubric)) {
        const notebook = workbook.context.model.sharedModel;
        if (!audited || !rubric) {
            set(workbook, null);
            notebook.deleteMetadata('correxit');
            notebook.clearUndoHistory();
            return null;
        }
        if (!audited.ok)
            throw new _error__rspack_import_3.Invalid(`update error: ${audited.error}`);
        set(workbook, audited.rubric);
        notebook.setMetadata('correxit', await ___rspack_import_5.Rubric.lock(audited.rubric));
        return audited.rubric;
    }
    Workbook.update = update;
})(Workbook || (Workbook = {}));


},
"./lib/index.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Assignment: () => (/* reexport safe */ _correxit__rspack_import_1.Assignment),
  Correxit: () => (/* reexport safe */ _correxit__rspack_import_2.Correxit),
  Rubric: () => (/* reexport safe */ _correxit__rspack_import_3.Rubric),
  Workbook: () => (/* reexport safe */ _correxit__rspack_import_4.Workbook),
  "default": () => (/* reexport safe */ _plugins__rspack_import_0.plugins)
});
/* import */ var _correxit__rspack_import_1 = __webpack_require__("./lib/correxit/assignment.js");
/* import */ var _correxit__rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _correxit__rspack_import_3 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit__rspack_import_4 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _plugins__rspack_import_0 = __webpack_require__("./lib/plugins.js");
/**
 * Public browser and JupyterLab API.
 *
 * The core models are discriminated unions: {@link Rubric} by `locked` and
 * {@link Workbook} by `content`.
 *
 * @module Browser
 */





},
"./lib/plugins.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  plugins: () => (plugins)
});
/* import */ var _jupyter_notebook_tree__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyter-notebook/tree/@jupyter-notebook/tree");
/* import */ var _jupyter_notebook_tree__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyter_notebook_tree__rspack_import_0);
/* import */ var _jupyterlab_application__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/application");
/* import */ var _jupyterlab_application__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_application__rspack_import_1);
/* import */ var _jupyterlab_apputils__rspack_import_2 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/apputils");
/* import */ var _jupyterlab_apputils__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__rspack_import_2);
/* import */ var _jupyterlab_codeeditor__rspack_import_3 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/codeeditor");
/* import */ var _jupyterlab_codeeditor__rspack_import_3_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_codeeditor__rspack_import_3);
/* import */ var _jupyterlab_docmanager__rspack_import_4 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/docmanager");
/* import */ var _jupyterlab_docmanager__rspack_import_4_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_docmanager__rspack_import_4);
/* import */ var _jupyterlab_filebrowser__rspack_import_5 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/filebrowser");
/* import */ var _jupyterlab_filebrowser__rspack_import_5_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_filebrowser__rspack_import_5);
/* import */ var _jupyterlab_launcher__rspack_import_6 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/launcher");
/* import */ var _jupyterlab_launcher__rspack_import_6_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_launcher__rspack_import_6);
/* import */ var _jupyterlab_notebook__rspack_import_7 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/notebook");
/* import */ var _jupyterlab_notebook__rspack_import_7_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__rspack_import_7);
/* import */ var _jupyterlab_rendermime__rspack_import_8 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/rendermime");
/* import */ var _jupyterlab_rendermime__rspack_import_8_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_rendermime__rspack_import_8);
/* import */ var _jupyterlab_settingregistry__rspack_import_9 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/settingregistry");
/* import */ var _jupyterlab_settingregistry__rspack_import_9_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_settingregistry__rspack_import_9);
/* import */ var _jupyterlab_statusbar__rspack_import_10 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/statusbar");
/* import */ var _jupyterlab_statusbar__rspack_import_10_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_statusbar__rspack_import_10);
/* import */ var _jupyterlab_translation__rspack_import_11 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/translation");
/* import */ var _jupyterlab_translation__rspack_import_11_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_translation__rspack_import_11);
/* import */ var _lumino_disposable__rspack_import_12 = __webpack_require__("webpack/sharing/consume/default/@lumino/disposable");
/* import */ var _lumino_disposable__rspack_import_12_default = /*#__PURE__*/__webpack_require__.n(_lumino_disposable__rspack_import_12);
/* import */ var _lumino_signaling__rspack_import_13 = __webpack_require__("webpack/sharing/consume/default/@lumino/signaling");
/* import */ var _lumino_signaling__rspack_import_13_default = /*#__PURE__*/__webpack_require__.n(_lumino_signaling__rspack_import_13);
/* import */ var jupyter_secrets_manager__rspack_import_14 = __webpack_require__("webpack/sharing/consume/default/jupyter-secrets-manager/jupyter-secrets-manager");
/* import */ var jupyter_secrets_manager__rspack_import_14_default = /*#__PURE__*/__webpack_require__.n(jupyter_secrets_manager__rspack_import_14);
/* import */ var _corrector__rspack_import_20 = __webpack_require__("./lib/corrector/corrector.js");
/* import */ var _correxit__rspack_import_16 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _correxit__rspack_import_22 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit__rspack_import_23 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _correxit__rspack_import_28 = __webpack_require__("./lib/correxit/unlocker.js");
/* import */ var _correxit_collectors__rspack_import_18 = __webpack_require__("./lib/correxit/collectors.js");
/* import */ var _correxit_dispatcher__rspack_import_15 = __webpack_require__("./lib/correxit/dispatcher.js");
/* import */ var _correxit_distributors__rspack_import_19 = __webpack_require__("./lib/correxit/distributors.js");
/* import */ var _correxit_providers_moodle__rspack_import_17 = __webpack_require__("./lib/correxit/providers/moodle.js");
/* import */ var _correxit_kernels__rspack_import_21 = __webpack_require__("./lib/correxit/kernels.js");
/* import */ var _correxit_registrars__rspack_import_25 = __webpack_require__("./lib/correxit/registrars.js");
/* import */ var _correxit_state__rspack_import_24 = __webpack_require__("./lib/correxit/state.js");
/* import */ var _correxit_submitters__rspack_import_26 = __webpack_require__("./lib/correxit/submitters.js");
/* import */ var _ui__rspack_import_27 = __webpack_require__("./lib/ui/sidebar.js");


























/** The Correxit grade collector dispatches to the configured provider. */
const collector = _correxit_dispatcher__rspack_import_15.dispatch(_correxit__rspack_import_16.Correxit.COLLECTOR, _correxit__rspack_import_16.Correxit.DESCRIPTION.COLLECTOR, _correxit__rspack_import_16.Correxit.Collector, (_, { moodle: settings, provider }) => {
    const collector = certified => {
        switch (provider()) {
            case 'moodle':
                return _correxit_providers_moodle__rspack_import_17.Moodle.collector(certified, settings());
            default:
                return _correxit_collectors__rspack_import_18.manual(certified);
        }
    };
    return [collector, () => { }];
});
/** The Correxit distributor dispatches to the configured provider. */
const distributor = _correxit_dispatcher__rspack_import_15.dispatch(_correxit__rspack_import_16.Correxit.DISTRIBUTOR, _correxit__rspack_import_16.Correxit.DESCRIPTION.DISTRIBUTOR, _correxit__rspack_import_16.Correxit.Distributor, (_, { moodle: settings, provider }) => {
    const distributor = propagated => {
        switch (provider()) {
            case 'moodle':
                return _correxit_providers_moodle__rspack_import_17.Moodle.distributor(propagated, settings());
            default:
                return _correxit_distributors__rspack_import_19.manual(propagated);
        }
    };
    return [distributor, () => { }];
});
/** The Correxit Corrector UI. */
const corrector = {
    id: _correxit__rspack_import_16.Correxit.CORRECTOR,
    description: _correxit__rspack_import_16.Correxit.DESCRIPTION.CORRECTOR,
    requires: [_correxit__rspack_import_16.Correxit.Collector, _jupyterlab_docmanager__rspack_import_4.IDocumentManager, _correxit__rspack_import_16.Correxit.Unlocker],
    optional: [
        _jupyterlab_apputils__rspack_import_2.ICommandPalette,
        _jupyterlab_filebrowser__rspack_import_5.IDefaultFileBrowser,
        _jupyterlab_codeeditor__rspack_import_3.IEditorServices,
        _jupyterlab_launcher__rspack_import_6.ILauncher,
        _jupyterlab_application__rspack_import_1.ILayoutRestorer,
        _jupyter_notebook_tree__rspack_import_0.INotebookTree,
        _jupyterlab_rendermime__rspack_import_8.IRenderMimeRegistry,
        _jupyterlab_settingregistry__rspack_import_9.ISettingRegistry,
        _jupyterlab_statusbar__rspack_import_10.IStatusBar,
        _jupyterlab_translation__rspack_import_11.ITranslator
    ],
    autoStart: true,
    ...((deactivator) => ({
        activate: (app, collector, documents, unlocker, palette, browser, editors, launcher, restorer, tree, rendermime, registry, status, translator) => {
            const corrector = 'correxit-corrector';
            const reviewer = 'correxit-reviewer';
            const trans = (translator || _jupyterlab_translation__rspack_import_11.nullTranslator).load('correxit');
            const tracker = {
                corrector: new _jupyterlab_apputils__rspack_import_2.WidgetTracker({
                    namespace: corrector
                }),
                reviewer: new _jupyterlab_apputils__rspack_import_2.WidgetTracker({
                    namespace: reviewer
                })
            };
            const indicator = new _corrector__rspack_import_20.Corrector.Status(trans);
            const active = new _lumino_signaling__rspack_import_13.Signal(tracker);
            tracker.corrector.currentChanged.connect(() => active.emit(undefined));
            const { down, fail, launch, left, pass, review, right, up } = _corrector__rspack_import_20.Corrector.CommandIDs;
            const added = _corrector__rspack_import_20.Corrector.commands(app, {
                browser,
                collector,
                documents,
                editors,
                indicator,
                rendermime,
                tracker,
                trans,
                tree,
                unlocker
            });
            if (status) {
                status.registerStatusItem('correxit-corrector:indicator', {
                    item: indicator,
                    align: 'right',
                    isActive: () => !!tracker.corrector.currentWidget,
                    activeStateChanged: active
                });
            }
            if (launcher) {
                added.push(launcher.add({ category: trans.__('Other'), command: launch }));
            }
            if (palette)
                added.push(palette.addItem({ category: 'Correxit', command: launch }));
            if (palette)
                added.push(palette.addItem({ category: 'Correxit', command: review }));
            if (restorer) {
                restorer.restore(tracker.corrector, {
                    command: launch,
                    name: ({ id }) => id,
                    args: ({ path }) => ({ path })
                });
                restorer.restore(tracker.reviewer, {
                    command: review,
                    name: ({ id }) => id
                });
            }
            if (registry) {
                void registry
                    .load(_correxit__rspack_import_16.Correxit.CORRECTOR)
                    .then(settings => {
                    const reconfigure = () => _correxit_kernels__rspack_import_21.configure(settings.composite);
                    const disconnect = new _lumino_disposable__rspack_import_12.DisposableDelegate(() => settings.changed.disconnect(reconfigure));
                    settings.changed.connect(reconfigure);
                    added.push(disconnect);
                    reconfigure();
                })
                    .catch(reason => console.warn(_correxit__rspack_import_16.Correxit.CORRECTOR, 'settings error', reason));
            }
            // Reviewer keybindings scoped to the reviewer widget.
            const selector = '.correxit-reviewer-widget';
            const bindings = [
                { keys: ['ArrowUp'], command: up, selector },
                { keys: ['K'], command: up, selector },
                { keys: ['ArrowDown'], command: down, selector },
                { keys: ['J'], command: down, selector },
                { keys: ['ArrowLeft'], command: left, selector },
                { keys: ['H'], command: left, selector },
                { keys: ['ArrowRight'], command: right, selector },
                { keys: ['L'], command: right, selector },
                { keys: ['P'], command: pass, selector },
                { keys: ['F'], command: fail, selector }
            ];
            for (const binding of bindings)
                added.push(app.commands.addKeyBinding(binding));
            deactivator = () => {
                added.forEach(command => command.dispose());
                indicator.dispose();
                tracker.corrector.dispose();
                tracker.reviewer.dispose();
            };
        },
        deactivate: () => deactivator === null || deactivator === void 0 ? void 0 : deactivator()
    }))()
};
/** Galata-only test bridge: exposes Correxit module for the ui tests. */
const galata = {
    id: _correxit__rspack_import_16.Correxit.GALATA,
    autoStart: true,
    ...((deactivator) => ({
        activate: () => {
            if (typeof window === 'undefined' || !window.galata)
                return;
            Object.defineProperty(window, '__correxit__', {
                configurable: false,
                enumerable: false,
                value: Object.freeze({
                    Correxit: _correxit__rspack_import_16.Correxit,
                    Rubric: _correxit__rspack_import_22.Rubric,
                    Workbook: _correxit__rspack_import_23.Workbook,
                    kernels: Object.freeze({
                        drain: _correxit_kernels__rspack_import_21.drain,
                        snapshot: _correxit_kernels__rspack_import_21.snapshot
                    })
                }),
                writable: false
            });
        },
        deactivate: () => deactivator === null || deactivator === void 0 ? void 0 : deactivator()
    }))()
};
/** The Correxit workbook monitor yields the active workbook or null. */
const monitor = {
    id: _correxit__rspack_import_16.Correxit.MONITOR,
    description: _correxit__rspack_import_16.Correxit.DESCRIPTION.MONITOR,
    autoStart: true,
    requires: [
        _correxit__rspack_import_16.Correxit.Collector,
        _correxit__rspack_import_16.Correxit.Distributor,
        _jupyterlab_docmanager__rspack_import_4.IDocumentManager,
        _correxit__rspack_import_16.Correxit.Registrar,
        _correxit__rspack_import_16.Correxit.Submitter,
        _correxit__rspack_import_16.Correxit.Unlocker,
        _jupyterlab_notebook__rspack_import_7.INotebookTracker
    ],
    optional: [_jupyterlab_translation__rspack_import_11.ITranslator],
    provides: _correxit__rspack_import_16.Correxit.Monitor,
    ...((deactivator) => ({
        activate: (app, collector, distributor, documents, registrar, submitter, unlocker, tracker, translator) => {
            var _a;
            translator || (translator = _jupyterlab_translation__rspack_import_11.nullTranslator);
            const { commands, shell } = app;
            // The sidebar can rely on metadata changes, but the native toolbar
            // buttons only change when their respective command has changed.
            const ui = [
                _correxit__rspack_import_16.Correxit.CommandIDs.configure,
                _correxit__rspack_import_16.Correxit.CommandIDs.convert,
                _correxit__rspack_import_16.Correxit.CommandIDs.correct,
                _correxit__rspack_import_16.Correxit.CommandIDs.distribute,
                _correxit__rspack_import_16.Correxit.CommandIDs.draft,
                _correxit__rspack_import_16.Correxit.CommandIDs.lock,
                _correxit__rspack_import_16.Correxit.CommandIDs.share,
                _correxit__rspack_import_16.Correxit.CommandIDs.submit,
                _correxit__rspack_import_16.Correxit.CommandIDs.unlock
            ];
            let ready = false;
            const notify = () => ready && ui.forEach(command => commands.notifyCommandChanged(command));
            const monitor = new _lumino_signaling__rspack_import_13.Stream(null);
            const swap = (prev, next) => {
                prev === null || prev === void 0 ? void 0 : prev.context.fileChanged.disconnect(notify);
                prev === null || prev === void 0 ? void 0 : prev.context.model.sharedModel.metadataChanged.disconnect(notify);
                next === null || next === void 0 ? void 0 : next.context.fileChanged.connect(notify);
                next === null || next === void 0 ? void 0 : next.context.model.sharedModel.metadataChanged.connect(notify);
            };
            const injector = (previous => workbook => {
                if (workbook === _correxit_state__rspack_import_24.workbook())
                    return;
                _correxit__rspack_import_23.Workbook.open(workbook, true);
                swap(previous, workbook);
                _correxit_state__rspack_import_24.workbook(workbook);
                previous = workbook;
                monitor.emit(workbook);
                notify();
            })(null);
            const slots = {
                shell: (_, { newValue }) => injector(newValue instanceof _jupyterlab_notebook__rspack_import_7.NotebookPanel ? newValue : null),
                tracker: (_, workbook) => injector(workbook)
            };
            (_a = shell.currentChanged) === null || _a === void 0 ? void 0 : _a.connect(slots.shell);
            tracker.currentChanged.connect(slots.tracker);
            injector(shell.currentWidget instanceof _jupyterlab_notebook__rspack_import_7.NotebookPanel
                ? shell.currentWidget
                : null);
            const added = _correxit__rspack_import_16.Correxit.commands(app, {
                collector,
                distributor,
                documents,
                injector,
                registrar,
                submitter,
                translator,
                unlocker
            });
            ready = true;
            notify();
            deactivator = () => {
                var _a;
                for (const command of added)
                    command.dispose();
                (_a = shell.currentChanged) === null || _a === void 0 ? void 0 : _a.disconnect(slots.shell);
                monitor.stop();
                _lumino_signaling__rspack_import_13.Signal.clearData(monitor);
                tracker.currentChanged.disconnect(slots.tracker);
            };
            return monitor;
        },
        deactivate: () => deactivator === null || deactivator === void 0 ? void 0 : deactivator()
    }))()
};
/** The Correxit assignment registrar dispatches to the configured provider. */
const registrar = _correxit_dispatcher__rspack_import_15.dispatch(_correxit__rspack_import_16.Correxit.REGISTRAR, _correxit__rspack_import_16.Correxit.DESCRIPTION.REGISTRAR, _correxit__rspack_import_16.Correxit.Registrar, (_, { moodle: settings, provider }) => {
    const registrar = (workbook, identifier) => {
        switch (provider()) {
            case 'moodle':
                return _correxit_providers_moodle__rspack_import_17.Moodle.registrar(workbook, identifier, settings());
            default:
                return _correxit_registrars__rspack_import_25.manual(workbook, identifier);
        }
    };
    return [registrar, () => { }];
});
/** The default Correxit assignment submitter, content-addressed digest. */
const submitter = {
    id: _correxit__rspack_import_16.Correxit.SUBMITTER,
    description: _correxit__rspack_import_16.Correxit.DESCRIPTION.SUBMITTER,
    autoStart: true,
    ...((deactivator) => ({
        provides: _correxit__rspack_import_16.Correxit.Submitter,
        activate: () => _correxit_submitters__rspack_import_26.manual,
        deactivate: () => deactivator === null || deactivator === void 0 ? void 0 : deactivator()
    }))()
};
/** The Correxit sidebar and notebook decoration UI. */
const ui = {
    id: _correxit__rspack_import_16.Correxit.UI,
    description: _correxit__rspack_import_16.Correxit.DESCRIPTION.UI,
    autoStart: true,
    requires: [_correxit__rspack_import_16.Correxit.Monitor],
    optional: [_jupyterlab_apputils__rspack_import_2.ICommandPalette, _jupyterlab_translation__rspack_import_11.ITranslator, _jupyterlab_application__rspack_import_1.ILayoutRestorer, _jupyterlab_settingregistry__rspack_import_9.ISettingRegistry],
    ...((deactivator) => ({
        activate: ({ commands, shell }, monitor, palette, translator, restorer, registry) => {
            const settings = registry ? registry.load(_correxit__rspack_import_16.Correxit.UI) : null;
            const trans = (translator || _jupyterlab_translation__rspack_import_11.nullTranslator).load('correxit');
            const options = { commands, monitor, settings, trans };
            const widget = new _ui__rspack_import_27.Sidebar.Widget(options);
            const launch = _correxit__rspack_import_16.Correxit.CommandIDs.launch;
            const caption = trans.__('Correxit');
            widget.id = 'correxit-sidebar';
            widget.title.caption = caption;
            widget.title.icon = _correxit__rspack_import_16.Correxit.Icons.correxit;
            widget.title.label = caption;
            shell.add(widget, 'right', {});
            const added = [
                commands.addCommand(launch, {
                    icon: _correxit__rspack_import_16.Correxit.Icons.correxit,
                    caption: trans.__('Open Correxit sidebar'),
                    label: trans.__('Open Correxit sidebar'),
                    execute: () => shell.activateById(widget.id)
                })
            ];
            if (restorer)
                restorer.add(widget, widget.id);
            if (palette) {
                const { CommandIDs } = _correxit__rspack_import_16.Correxit;
                const exposed = [
                    CommandIDs.launch,
                    CommandIDs.convert,
                    CommandIDs.lock,
                    CommandIDs.unlock,
                    CommandIDs.track,
                    CommandIDs.certify,
                    CommandIDs.correct,
                    CommandIDs.collect,
                    CommandIDs.distribute,
                    CommandIDs.submit,
                    CommandIDs.revise,
                    CommandIDs.draft,
                    CommandIDs.reset
                ];
                for (const command of exposed)
                    palette.addItem({ category: 'Correxit', command });
            }
            deactivator = () => {
                added.forEach(command => command.dispose());
                widget.dispose();
            };
        },
        deactivate: () => deactivator === null || deactivator === void 0 ? void 0 : deactivator()
    }))()
};
/** The default Correxit unlocker, signed by the Jupyter secrets manager. */
const unlocker = jupyter_secrets_manager__rspack_import_14.SecretsManager.sign(_correxit__rspack_import_16.Correxit.UNLOCKER, token => {
    return {
        id: _correxit__rspack_import_16.Correxit.UNLOCKER,
        description: _correxit__rspack_import_16.Correxit.DESCRIPTION.UNLOCKER,
        autoStart: true,
        provides: _correxit__rspack_import_16.Correxit.Unlocker,
        requires: [jupyter_secrets_manager__rspack_import_14.ISecretsManager],
        optional: [_jupyterlab_translation__rspack_import_11.ITranslator],
        ...((deactivator) => ({
            activate: (_, manager, translator) => {
                if (!token) {
                    console.warn(_correxit__rspack_import_16.Correxit.UNLOCKER, 'Secrets manager token unavailable');
                    return {
                        store: () => Promise.resolve(),
                        unlock: () => Promise.reject(new _correxit__rspack_import_16.Correxit.Error.Plugin('Secrets manager token unavailable'))
                    };
                }
                const trans = (translator || _jupyterlab_translation__rspack_import_11.nullTranslator).load('correxit');
                const secrets = {
                    manager,
                    passphrases: new Set(),
                    pending: null,
                    token
                };
                return {
                    store: (id, key) => _correxit__rspack_import_28.Unlocker.store(id, key, secrets),
                    unlock: async (workbook, credentials) => _correxit__rspack_import_28.Unlocker.unlock(workbook, credentials, secrets, trans)
                };
            },
            deactivate: () => deactivator === null || deactivator === void 0 ? void 0 : deactivator()
        }))()
    };
});
/** JupyterLab plugins provided by the Correxit package. */
const plugins = [
    collector,
    corrector,
    distributor,
    galata,
    monitor,
    registrar,
    submitter,
    ui,
    unlocker
];


},
"./lib/ui/annotate.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Annotate: () => (Annotate)
});
/* import */ var react__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_0);
/* import */ var ___rspack_import_1 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit_security__rspack_import_3 = __webpack_require__("./lib/correxit/security.js");
/* import */ var _correxit_state__rspack_import_4 = __webpack_require__("./lib/correxit/state.js");




const correct = 'cxt-mod-correct';
const encrypted = 'cxt-mod-encrypted';
const incorrect = 'cxt-mod-incorrect';
const partial = 'cxt-mod-partial';
/**
 * Synchronizes rubric state with the active notebook UI.
 *
 * The component does two kinds of work. Imperatively, it stamps notebook cells
 * with transient classes for rubric role, grading state, and encryption.
 * Declaratively, it renders a scoped stylesheet whose rules draw connector
 * geometry for the active cell's reference group.
 *
 * Lifecycle is bound to the Correxit sidebar. On mount and update it replays
 * the current decorations against the active notebook. On cleanup it removes
 * the classes and notebook scope it owns. Static annotation styling lives in
 * CSS; only the connector topology is synthesized here from notebook order.
 */
const Annotate = props => {
    var _a;
    const { workbook } = props;
    const rubric = ___rspack_import_1.Workbook.open(workbook, true);
    const notebook = workbook === null || workbook === void 0 ? void 0 : workbook.content;
    const active = ((_a = notebook === null || notebook === void 0 ? void 0 : notebook.activeCell) === null || _a === void 0 ? void 0 : _a.model.id) || null;
    const layout = JSON.stringify(notebook === null || notebook === void 0 ? void 0 : notebook.widgets.map(({ model }) => model.id));
    const scope = rubric ? track(rubric.id) : null;
    const linked = active && rubric ? referents(rubric, active) : [];
    const order = notebook
        ? new Map(notebook.widgets.map(({ model }, i) => [model.id, i]))
        : null;
    const css = active && scope && order ? rules(scope, active, linked, order) : '';
    (0,react__rspack_import_0.useEffect)(() => {
        if (!notebook || !rubric || notebook.isDisposed)
            return;
        const marks = {
            notebook,
            scope: null,
            widgets: new Map()
        };
        const ids = new Set([
            ...Object.keys(rubric.cells),
            ...Object.values(rubric.references).map(({ referent }) => referent)
        ]);
        for (const widget of notebook.widgets) {
            const { id } = widget.model;
            if (!ids.has(id))
                continue;
            mark(marks, widget, stamp(id));
            const cell = ___rspack_import_2.Rubric.get(rubric, id);
            if (cell)
                decorate(marks, workbook, cell, widget);
            if (_correxit_security__rspack_import_3.encrypted(widget.model.sharedModel.getSource()))
                mark(marks, widget, encrypted);
        }
        if (scope && css) {
            notebook.addClass(scope);
            marks.scope = scope;
        }
        return () => clear(marks);
    }, [active, css, layout, notebook, rubric, scope, workbook]);
    return react__rspack_import_0_default().createElement("style", null, css);
};
function clear(marks) {
    const { notebook, scope, widgets } = marks;
    if (scope && notebook && !notebook.isDisposed)
        notebook.removeClass(scope);
    widgets.forEach((decorations, widget) => {
        if (widget.isDisposed)
            return;
        decorations.forEach(decoration => widget.removeClass(decoration));
    });
}
function decorate(marks, workbook, cell, widget) {
    const report = _correxit_state__rspack_import_4.report(workbook, cell.id);
    mark(marks, widget, `cxt-mod-${cell.is}`);
    if (!report || report.status === 'unscored')
        return;
    if (report.code === 'locked')
        mark(marks, widget, partial);
    else if (report.points === cell.points)
        mark(marks, widget, correct);
    else if (report.points > 0)
        mark(marks, widget, partial);
    else
        mark(marks, widget, incorrect);
}
function mark(marks, widget, decoration) {
    const decorations = marks.widgets.get(widget) || new Set();
    if (decorations.has(decoration))
        return;
    widget.addClass(decoration);
    decorations.add(decoration);
    marks.widgets.set(widget, decorations);
}
function referents(rubric, id) {
    if (!id)
        return [];
    const cells = Object.values(rubric.cells);
    const group = new Set([id]);
    const queue = [id];
    while (queue.length) {
        const current = queue.pop();
        const cell = ___rspack_import_2.Rubric.get(rubric, current);
        const linked = cell && (cell.is === 'comparable' || cell.is === 'correctable')
            ? cell.references
            : cells
                .filter(cell => { var _a; return (_a = cell.references) === null || _a === void 0 ? void 0 : _a.includes(current); })
                .map(cell => cell.id);
        for (const peer of linked) {
            if (group.has(peer))
                continue;
            group.add(peer);
            queue.push(peer);
        }
    }
    group.delete(id);
    return Array.from(group);
}
function rules(scope, active, linked, order) {
    const group = [active, ...linked]
        .filter(id => order.has(id))
        .sort((a, b) => order.get(a) - order.get(b));
    if (group.length < 2)
        return '';
    const lane = 'calc(var(--jp-cell-padding) + var(--jp-cell-collapser-width) / 2 - 1px)';
    const tone = 'var(--jp-brand-color1)';
    const cap = (id, y) => id === active
        ? ''
        : `
    .jp-Notebook.${scope} .jp-Cell.${stamp(id)} {
      background-image: linear-gradient(to right, ${tone}, ${tone});
      background-position: ${lane} ${y};
      background-repeat: no-repeat;
      background-size: 10px 1px;
    }
  `;
    const editor = (id) => `.jp-Notebook.${scope} .jp-Cell.${stamp(id)} .jp-InputArea-editor`;
    const endpoints = group.map(editor).join(',\n');
    const head = group[0];
    const tail = group[group.length - 1];
    const gap = order.get(tail) - order.get(head);
    const floor = tail === active ? 'var(--jp-cell-padding)' : '0';
    const first = `.jp-Notebook.${scope} .jp-Cell.${stamp(head)}`;
    const last = `.jp-Notebook.${scope} .jp-Cell.${stamp(tail)}`;
    const middle = gap < 2 ? '' : `${first} ~ .jp-Cell:not(${last}):not(${last} ~ .jp-Cell)`;
    const span = [first, middle, last].filter(Boolean);
    const chain = span.join(',\n');
    const bars = span.map(selector => `${selector}::before`).join(',\n');
    const gutters = span.map(selector => `${selector} .jp-Collapser`).join(',\n');
    return `
    ${chain} { position: relative; }
    ${gutters} {
      position: relative;
      z-index: 1;
    }
    ${endpoints} { box-shadow: inset 2px 0 0 ${tone}; }
    ${bars} {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: ${lane};
      width: 1px;
      border-radius: 999px;
      background: repeating-linear-gradient(
        to bottom,
        ${tone},
        ${tone} 2px,
        transparent 2px,
        transparent 6px
      );
      opacity: 0.7;
      z-index: 0;
      pointer-events: none;
    }
    ${first}::before { top: var(--jp-cell-padding); }
    ${last}::before { bottom: ${floor}; }
    ${cap(head, 'var(--jp-cell-padding)')}
    ${cap(tail, 'calc(100% - 1px)')}
  `;
}
function stamp(id) {
    return `cxt-cell-${token(id)}`;
}
function token(id) {
    return id.replace(/[^A-Za-z0-9_-]/g, '_');
}
function track(id) {
    return `cxt-scope-${token(id)}`;
}


},
"./lib/ui/assignment.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Assignment: () => (Assignment)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/correxit/workbook.js");



const DELAY = 150;
const TTL = 10000;
const { assign, enroll, resource, track } = ___rspack_import_2.Correxit.CommandIDs;
const { Equal } = ___rspack_import_3.Rubric.Assignment;
const enrolled = new WeakMap();
const identify = ({ id, name }) => id || name;
const blank = (assignment) => ({
    ...assignment,
    assignee: '',
    expiration: null,
    id: null,
    name: '',
    overdue: null,
    penalty: null,
    roster: []
});
const equal = Equal.assignment;
const freeze = (assignment, active) => ({
    ...assignment,
    ...active,
    assignee: active.roster.includes(assignment.assignee)
        ? assignment.assignee
        : '',
    overdue: null,
    penalty: null
});
const courses = (registered) => registered === null
    ? null
    : registered.length && 'group' in registered[0]
        ? registered
        : [{ assignments: registered, group: '' }];
const flat = (course) => course.flatMap(({ assignments }) => assignments);
const split = (value) => Array.from(new Set(value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)));
const same = (x, y) => x.length === y.length && x.every((record, i) => record === y[i]);
const count = ({ roster }, trans) => trans.__('%1 entries', roster.length);
const due = ({ expiration }, trans) => ___rspack_import_3.Rubric.timestamp(expiration, trans.__('No deadline'));
const policy = ({ overdue, penalty }, trans) => {
    if (overdue === 'dock')
        return trans.__('Dock %1%', penalty !== null && penalty !== void 0 ? penalty : 0);
    if (overdue === 'reject')
        return trans.__('Reject submission');
    return trans.__('Accept late');
};
const headline = ({ name }, manual, trans) => {
    if (name)
        return name;
    return manual ? trans.__('Manual roster') : trans.__('No assignment');
};
const option = (registration) => (react__rspack_import_1_default().createElement("option", { key: identify(registration), value: identify(registration) }, registration.name));
var Draft;
(function (Draft) {
    function create(assignment) {
        return { assignment, local: false };
    }
    Draft.create = create;
    function edit(state, assignment) {
        return equal(state.assignment, assignment)
            ? state
            : { assignment, local: true };
    }
    Draft.edit = edit;
    function merge(state, mutate) {
        return edit(state, mutate(state.assignment));
    }
    Draft.merge = merge;
    function persist(state, assignment, locked) {
        return state.local && !locked && !equal(state.assignment, assignment);
    }
    Draft.persist = persist;
    function sync(state, assignment) {
        return equal(state.assignment, assignment)
            ? state.local
                ? { ...state, local: false }
                : state
            : { assignment, local: false };
    }
    Draft.sync = sync;
})(Draft || (Draft = {}));
const Assignment = ({ commands, trans, workbook }) => {
    var _a;
    const rubric = ___rspack_import_4.Workbook.open(workbook, true);
    const { locked } = rubric;
    const [state, setState] = (0,react__rspack_import_1.useState)(() => Draft.create(rubric.assignment));
    const [registered, setRegistered] = (0,react__rspack_import_1.useState)(null);
    const [overwrite, setOverwrite] = (0,react__rspack_import_1.useState)(false);
    const [pending, setPending] = (0,react__rspack_import_1.useState)(false);
    const [selected, setSelected] = (0,react__rspack_import_1.useState)(null);
    const { assignment, local } = state;
    const cached = rubric.id;
    const keep = (next) => setState(current => Draft.sync(current, next));
    const edit = (assignment) => setState(current => Draft.edit(current, assignment));
    const merge = (mutate) => setState(current => Draft.merge(current, mutate));
    const pick = (next) => setSelected(current => (current === next ? current : next));
    const store = (next) => setRegistered(current => Equal.registered(current, next) ? current : next);
    const reassign = (assignment, locked) => {
        if (!locked && !equal(rubric.assignment, assignment))
            void commands.execute(assign, assignment).catch(_ => { });
    };
    const request = async () => {
        const now = Date.now();
        const current = enrolled.get(workbook);
        if ((current === null || current === void 0 ? void 0 : current.cached) === cached)
            store(current.registered);
        setPending(!current);
        if ((current === null || current === void 0 ? void 0 : current.cached) === cached && now < current.expires)
            return;
        try {
            const result = await commands.execute(enroll).catch(_ => null);
            const registered = result;
            enrolled.set(workbook, { cached, expires: now + TTL, registered });
            store(registered);
        }
        finally {
            setPending(false);
        }
    };
    // Enrollment is refreshed only when the workbook or rubric identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    (0,react__rspack_import_1.useEffect)(() => void request(), [cached, workbook]);
    (0,react__rspack_import_1.useEffect)(() => keep(rubric.assignment), [rubric.assignment]);
    (0,react__rspack_import_1.useEffect)(() => {
        if (locked)
            return;
        const resolved = courses(registered);
        const roster = resolved ? flat(resolved) : null;
        if (roster === null) {
            pick(null);
            return;
        }
        if (!roster.length) {
            pick(null);
            merge(blank);
            return;
        }
        const matched = selected
            ? roster.find(r => identify(r) === selected)
            : selected === ''
                ? null
                : roster.find(record => identify(record) === rubric.assignment.id) ||
                    (roster.length === 1 ? roster[0] : null);
        if (!matched) {
            if (selected !== '')
                pick(null);
            merge(blank);
            return;
        }
        pick(identify(matched));
        merge(current => freeze(current, matched));
    }, [locked, registered, rubric.assignment.id, selected]);
    // The listed values are semantic inputs; `reassign` is a render-local verb.
    /* eslint-disable react-hooks/exhaustive-deps */
    (0,react__rspack_import_1.useEffect)(() => {
        const dirty = Draft.persist({ assignment, local }, rubric.assignment, locked);
        if (!dirty)
            return;
        const delay = window.setTimeout(() => reassign(assignment, locked), DELAY);
        return () => window.clearTimeout(delay);
    }, [assignment, local, locked, rubric.assignment]);
    /* eslint-enable react-hooks/exhaustive-deps */
    const all = (_a = courses(registered)) !== null && _a !== void 0 ? _a : (locked ? [{ assignments: [rubric.assignment], group: '' }] : null);
    const roster = all ? flat(all) : null;
    const manual = roster === null;
    const multiple = !!roster && roster.length > 1;
    if (pending)
        return react__rspack_import_1_default().createElement("div", { className: "correxit-assignment cxt-mod-pending" });
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment" },
        react__rspack_import_1_default().createElement(Facts, { ...{ assignment, manual, trans } }),
        react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-controls" },
            manual ? (react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null,
                react__rspack_import_1_default().createElement(Roster, { ...{ assignment, edit, locked, trans } }),
                react__rspack_import_1_default().createElement(Assignee, { ...{ assignment, edit, locked, trans } }))) : (react__rspack_import_1_default().createElement(Enrollment, { ...{
                    all: all,
                    assignment,
                    commands,
                    locked,
                    multiple,
                    registered: roster,
                    selected,
                    setSelected,
                    trans
                } })),
            manual && react__rspack_import_1_default().createElement(Expiration, { ...{ assignment, edit, locked, trans } }),
            manual && react__rspack_import_1_default().createElement(Overdue, { ...{ assignment, edit, locked, trans } }),
            react__rspack_import_1_default().createElement(Resources, { ...{ assignment, commands, locked, trans } })),
        !locked && (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-propagate" },
            react__rspack_import_1_default().createElement("label", { className: "correxit-assignment-overwrite" },
                react__rspack_import_1_default().createElement("input", { checked: overwrite, onChange: ({ target }) => setOverwrite(target.checked), type: "checkbox" }),
                trans.__('Replace existing')),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { args: { overwrite }, commands: commands, id: track })))));
};
const Facts = ({ assignment, manual, trans }) => {
    const facts = [
        {
            label: trans.__('Assignment'),
            value: headline(assignment, manual, trans)
        },
        {
            label: trans.__('Assignee'),
            value: assignment.assignee || trans.__('Template')
        },
        {
            label: trans.__('Roster'),
            value: count(assignment, trans)
        },
        {
            label: trans.__('Deadline'),
            value: due(assignment, trans)
        }
    ];
    if (manual && assignment.expiration !== null) {
        facts.push({
            label: trans.__('Overdue'),
            value: policy(assignment, trans)
        });
    }
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-facts" }, facts.map(({ label, value }) => (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-fact", key: label },
        react__rspack_import_1_default().createElement("span", { className: "correxit-assignment-fact-label" }, label),
        react__rspack_import_1_default().createElement("span", { className: "correxit-assignment-fact-value", title: value }, value))))));
};
const Assignee = ({ assignment, edit, locked, trans }) => {
    const id = 'correxit-assignment-assignee';
    const unassigned = trans.__('Template - unassigned');
    const { assignee, roster } = assignment;
    if (locked) {
        const assignee = assignment.assignee || unassigned;
        return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-assignee" },
            react__rspack_import_1_default().createElement("div", null,
                react__rspack_import_1_default().createElement("label", null, trans.__('Assignee')),
                react__rspack_import_1_default().createElement("div", { className: "correxit-monospace" }, assignee))));
    }
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-assignee" },
        react__rspack_import_1_default().createElement("div", null,
            react__rspack_import_1_default().createElement("label", { htmlFor: id }, trans.__('Assignee')),
            !roster.length && (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-hint" }, trans.__('Add roster entries first.'))),
            react__rspack_import_1_default().createElement("select", { disabled: !roster.length, id: id, name: "correxit-assignment-assignee", onChange: ({ target: { value } }) => edit({ ...assignment, assignee: value }), value: assignee },
                react__rspack_import_1_default().createElement("option", { value: "" }, roster.length
                    ? trans.__('Template - unassigned (roster: %1)', roster.length)
                    : trans.__('Template - unassigned (roster: empty)')),
                roster.map((value, key) => (react__rspack_import_1_default().createElement("option", { ...{ key, value } }, value)))))));
};
const Expiration = ({ assignment, edit, locked, trans }) => {
    const { expiration } = assignment;
    const className = expiration !== null && Date.now() > expiration
        ? 'correxit-assignment-expiration cxt-mod-expired'
        : 'correxit-assignment-expiration';
    if (locked) {
        const label = ___rspack_import_3.Rubric.timestamp(expiration, trans.__('No deadline'));
        return (react__rspack_import_1_default().createElement("div", { className: className },
            react__rspack_import_1_default().createElement("div", { className: "correxit-monospace" }, label)));
    }
    const format = (timestamp) => {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    const update = (value) => {
        const expiration = value ? new Date(value).getTime() : null;
        edit({
            ...assignment,
            expiration,
            overdue: expiration === null ? null : assignment.overdue,
            penalty: expiration === null ? null : assignment.penalty
        });
    };
    return (react__rspack_import_1_default().createElement("div", { className: className },
        react__rspack_import_1_default().createElement("div", null,
            react__rspack_import_1_default().createElement("label", { htmlFor: "correxit-assignment-expiration" }, trans.__('Deadline')),
            react__rspack_import_1_default().createElement("input", { id: "correxit-assignment-expiration", name: "correxit-assignment-expiration", onChange: ({ target: { value } }) => update(value), type: "datetime-local", value: expiration ? format(expiration) : '' }))));
};
const Overdue = ({ assignment, edit, locked, trans }) => {
    var _a, _b;
    const current = (_a = assignment.overdue) !== null && _a !== void 0 ? _a : 'accept';
    const id = 'correxit-assignment-penalty';
    const hint = `${id}-hint`;
    const initial = current === 'dock' ? String((_b = assignment.penalty) !== null && _b !== void 0 ? _b : 10) : '';
    const [text, setText] = (0,react__rspack_import_1.useState)(initial);
    (0,react__rspack_import_1.useEffect)(() => {
        var _a;
        const next = current === 'dock' ? String((_a = assignment.penalty) !== null && _a !== void 0 ? _a : 10) : '';
        setText(current => (current === next ? current : next));
    }, [assignment.penalty, current]);
    if (assignment.expiration === null)
        return null;
    if (locked) {
        return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-overdue" },
            react__rspack_import_1_default().createElement("div", null,
                react__rspack_import_1_default().createElement("label", null, trans.__('Overdue')),
                react__rspack_import_1_default().createElement("div", { className: "correxit-monospace" }, policy(assignment, trans)))));
    }
    const update = (overdue) => {
        var _a;
        edit({
            ...assignment,
            overdue,
            penalty: overdue === 'dock' ? ((_a = assignment.penalty) !== null && _a !== void 0 ? _a : 10) : null
        });
    };
    const penalty = (value) => {
        setText(value);
        if (!value.trim())
            return;
        const parsed = Number(value);
        if (!Number.isInteger(parsed))
            return;
        const penalty = Math.max(0, Math.min(100, parsed));
        edit({ ...assignment, overdue: 'dock', penalty });
    };
    const reset = () => { var _a; return setText(String((_a = assignment.penalty) !== null && _a !== void 0 ? _a : 10)); };
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-overdue" },
        react__rspack_import_1_default().createElement("div", null,
            react__rspack_import_1_default().createElement("label", { htmlFor: "correxit-assignment-overdue" }, trans.__('Overdue')),
            react__rspack_import_1_default().createElement("select", { id: "correxit-assignment-overdue", name: "correxit-assignment-overdue", onChange: ({ target: { value } }) => update(value), value: current },
                react__rspack_import_1_default().createElement("option", { value: "accept" }, trans.__('Accept late')),
                react__rspack_import_1_default().createElement("option", { value: "dock" }, trans.__('Dock score')),
                react__rspack_import_1_default().createElement("option", { value: "reject" }, trans.__('Reject submission'))),
            current === 'dock' && (react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null,
                react__rspack_import_1_default().createElement("label", { htmlFor: id }, trans.__('Penalty')),
                react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-hint", id: hint }, trans.__('Percentage of possible points to deduct.')),
                react__rspack_import_1_default().createElement("input", { "aria-describedby": hint, id: id, max: 100, min: 0, name: "correxit-assignment-penalty", onBlur: reset, onChange: ({ target: { value } }) => penalty(value), step: 1, type: "number", value: text }))))));
};
const Roster = ({ assignment, edit, locked, trans }) => {
    const id = 'correxit-assignment-roster';
    const hint = `${id}-hint`;
    const seed = assignment.roster.join('\n');
    const [value, setValue] = (0,react__rspack_import_1.useState)(seed);
    (0,react__rspack_import_1.useEffect)(() => {
        if (same(split(value), assignment.roster))
            return;
        setValue(seed);
    }, [assignment.roster, seed, value]);
    const update = (value) => {
        const roster = split(value);
        setValue(value);
        edit({
            ...assignment,
            assignee: roster.includes(assignment.assignee) ? assignment.assignee : '',
            roster
        });
    };
    if (locked) {
        const title = seed || undefined;
        return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-roster" },
            react__rspack_import_1_default().createElement("div", null,
                react__rspack_import_1_default().createElement("label", null, trans.__('Roster')),
                react__rspack_import_1_default().createElement("div", { className: assignment.roster.length
                        ? 'correxit-assignment-list'
                        : 'correxit-assignment-list cxt-mod-empty', title: title }, seed || trans.__('No roster entries')))));
    }
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-roster" },
        react__rspack_import_1_default().createElement("div", null,
            react__rspack_import_1_default().createElement("label", { htmlFor: id }, trans.__('Roster')),
            react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-hint", id: hint }, trans.__('One assignee per line.')),
            react__rspack_import_1_default().createElement("textarea", { "aria-describedby": hint, id: id, "data-lm-suppress-shortcuts": "true", name: "correxit-assignment-roster", onBlur: () => setValue(assignment.roster.join('\n')), onChange: ({ target: { value } }) => update(value), rows: 6, spellCheck: false, value: value }))));
};
const Resources = ({ assignment, commands, locked, trans }) => {
    var _a;
    const { resources } = assignment;
    const list = (_a = resources === null || resources === void 0 ? void 0 : resources.join('\n')) !== null && _a !== void 0 ? _a : '';
    const empty = trans.__('No resource files');
    if (locked) {
        return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-resources" },
            react__rspack_import_1_default().createElement("div", null,
                react__rspack_import_1_default().createElement("label", null, trans.__('Resources')),
                react__rspack_import_1_default().createElement("div", { className: resources
                        ? 'correxit-assignment-list'
                        : 'correxit-assignment-list cxt-mod-empty', title: list || undefined }, list || empty))));
    }
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-resources" },
        react__rspack_import_1_default().createElement("div", null,
            react__rspack_import_1_default().createElement("label", null, trans.__('Resources')),
            resources ? (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-list", title: list }, list)) : (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-list cxt-mod-empty" }, empty)),
            react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-resource-actions" },
                react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { commands: commands, id: resource, label: trans.__('Pick files...') }),
                resources && (react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { commands: commands, id: resource, args: { resources: null }, label: trans.__('Clear') }))))));
};
const Enrollment = props => {
    const { all, assignment: { assignee }, commands, locked, multiple, registered, selected, setSelected, trans } = props;
    if (!registered.length) {
        return (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-chip", title: trans.__('No registrations') }, trans.__('No registrations')));
    }
    const unassigned = trans.__('Template - unassigned');
    return (react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null,
        multiple && !locked && (react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-assignee" },
            react__rspack_import_1_default().createElement("div", null,
                react__rspack_import_1_default().createElement("label", { htmlFor: "correxit-assignment-registration" }, trans.__('Assignment')),
                react__rspack_import_1_default().createElement("select", { disabled: !!assignee, id: "correxit-assignment-registration", name: "correxit-assignment-registration", onChange: ({ target: { value } }) => setSelected(value), value: selected !== null && selected !== void 0 ? selected : '' },
                    react__rspack_import_1_default().createElement("option", { value: "" }, trans.__('No assignment')),
                    all.some(({ group }) => group)
                        ? all.map(({ assignments, group }) => (react__rspack_import_1_default().createElement("optgroup", { key: group, label: group }, assignments.map(option))))
                        : registered.map(option))))),
        react__rspack_import_1_default().createElement("div", { className: "correxit-assignment-assignee" },
            react__rspack_import_1_default().createElement("div", { className: "correxit-monospace" }, assignee || unassigned),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ commands, id: ___rspack_import_2.Correxit.CommandIDs.unassign, label: '' } }))));
};


},
"./lib/ui/body.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Body: () => (Body)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var _correxit_state__rspack_import_5 = __webpack_require__("./lib/correxit/state.js");
/* import */ var _cell__rspack_import_6 = __webpack_require__("./lib/ui/cell.js");
/* import */ var _references__rspack_import_7 = __webpack_require__("./lib/ui/references.js");






const { configure, correct, remove, share } = ___rspack_import_2.Correxit.CommandIDs;
const { get } = ___rspack_import_3.Rubric;
const Body = ({ commands, trans, workbook }) => {
    var _a, _b, _c;
    const rubric = ___rspack_import_4.Workbook.open(workbook, true);
    const active = ___rspack_import_4.Workbook.headed(workbook)
        ? (_a = workbook.content.activeCell) === null || _a === void 0 ? void 0 : _a.model.id
        : _correxit_state__rspack_import_5.cursor();
    if (!rubric || !active) {
        return (react__rspack_import_1_default().createElement("section", { "aria-label": trans.__('Cell controls'), className: "correxit-sidebar-body" }));
    }
    const id = active;
    const hints = {
        answerable: trans.__('Expected output has been set.'),
        comparable: trans.__('Cell output is compared against a reference.'),
        correctable: trans.__('Cell is corrected by reference cells.'),
        reference: trans.__('Selected cell is a reference cell.'),
        reviewable: trans.__('Cell is manually reviewed.')
    };
    const hint = (_c = (_b = get(rubric, id)) === null || _b === void 0 ? void 0 : _b.is) !== null && _c !== void 0 ? _c : (id in rubric.references && 'reference');
    return (react__rspack_import_1_default().createElement("section", { "aria-label": trans.__('Cell controls'), className: "correxit-sidebar-body" },
        react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-cell-config" },
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ commands, id: correct } }),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id }, commands, id: correct } })),
        react__rspack_import_1_default().createElement(_cell__rspack_import_6.Score, { ...{ commands, id, rubric, trans, workbook } }),
        react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-cell-pair" },
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id, is: 'answerable' }, commands, id: configure } }),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id, is: 'reviewable' }, commands, id: configure } }),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id, is: 'comparable' }, commands, id: configure } }),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id, is: 'correctable' }, commands, id: configure } }),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id }, commands, id: remove } })),
        react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-cell-actions" },
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id }, commands, id: share } })),
        react__rspack_import_1_default().createElement(_references__rspack_import_7.References, { ...{ commands, id, rubric, trans, workbook } }),
        hint && react__rspack_import_1_default().createElement("p", { className: "correxit-sidebar-cell-hint" }, hints[hint])));
};


},
"./lib/ui/boundary.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Boundary: () => (Boundary)
});
/* import */ var react__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_0);

class Boundary extends (react__rspack_import_0_default().Component) {
    constructor() {
        super(...arguments);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    render() {
        const { error } = this.state;
        if (!error)
            return this.props.children;
        return (react__rspack_import_0_default().createElement("section", { className: "correxit-boundary" },
            react__rspack_import_0_default().createElement("p", { className: "correxit-boundary-label" }, this.props.label),
            react__rspack_import_0_default().createElement("pre", { className: "correxit-boundary-detail" }, error.message),
            error.stack && (react__rspack_import_0_default().createElement("details", null,
                react__rspack_import_0_default().createElement("summary", null,
                    react__rspack_import_0_default().createElement("code", null, "error.stack")),
                react__rspack_import_0_default().createElement("pre", { className: "correxit-boundary-stack" }, error.stack)))));
    }
}


},
"./lib/ui/cell.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Score: () => (Score)
});
/* import */ var react__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_0);
/* import */ var ___rspack_import_1 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _correxit_state__rspack_import_3 = __webpack_require__("./lib/correxit/state.js");



const { CommandIDs } = ___rspack_import_1.Correxit;
const { get } = ___rspack_import_2.Rubric;
const whole = (value) => {
    if (value === '')
        return '';
    const parsed = Number(value);
    if (Number.isNaN(parsed))
        return '';
    return Math.max(0, Math.floor(parsed));
};
const Score = ({ commands, id, rubric, trans, workbook }) => {
    const cell = get(rubric, id);
    const cached = _correxit_state__rspack_import_3.report(workbook, id);
    const persisted = ___rspack_import_2.Rubric.Score.resolve(rubric.assignment.report, id);
    const report = rubric.locked ? (cached !== null && cached !== void 0 ? cached : persisted) : (persisted !== null && persisted !== void 0 ? persisted : cached);
    const intervened = !!rubric.assignment.report.interventions[id];
    const scored = report && report.status !== 'unscored' ? report.points : '';
    const seed = {
        comment: report ? report.comment : '',
        points: cell ? cell.points : 1,
        possible: report ? report.possible : '',
        score: scored,
        status: report ? report.status : 'unscored',
        value: report ? report.points : ''
    };
    const [comment, setComment] = (0,react__rspack_import_0.useState)(seed.comment);
    const [points, setPoints] = (0,react__rspack_import_0.useState)(seed.points);
    const [score, setScore] = (0,react__rspack_import_0.useState)(seed.score);
    (0,react__rspack_import_0.useEffect)(() => {
        setComment(seed.comment);
        setPoints(seed.points);
        setScore(seed.score);
    }, [
        id,
        rubric.id,
        rubric.assignment.assignee,
        rubric.locked,
        seed.comment,
        seed.points,
        seed.possible,
        seed.score,
        seed.status,
        seed.value
    ]);
    if (!cell)
        return react__rspack_import_0_default().createElement((react__rspack_import_0_default().Fragment), null);
    const assigned = !!rubric.assignment.assignee;
    const derived = cell.is === 'comparable' || cell.is === 'correctable';
    const heading = rubric.locked
        ? trans.__('Cell score')
        : trans.__('Cell configuration');
    const computed = report && report.status !== 'unscored' ? report.points : '-';
    const subheading = trans.__('%1 of %2', computed, cell.points);
    const ids = {
        comment: `correxit-sidebar-cell-score-comment-${id}`,
        heading: `correxit-sidebar-cell-score-heading-${id}`,
        points: `correxit-sidebar-cell-score-points-${id}`,
        score: `correxit-sidebar-cell-score-value-${id}`
    };
    const intervene = async () => {
        if (rubric.locked || !assigned)
            return;
        if (typeof score === 'number' && !Number.isNaN(score)) {
            const possible = typeof points === 'number' ? points : cell.points;
            const update = { comment, points: score, possible };
            const intervention = ___rspack_import_2.Rubric.Score.intervene(id, update);
            await commands.execute(CommandIDs.intervene, { id, intervention });
            return;
        }
        if (intervened)
            await commands.execute(CommandIDs.intervene, { id, intervention: null });
    };
    const commentate = async () => {
        if (!assigned || comment === seed.comment)
            return;
        await commands.execute(CommandIDs.comment, { id, comment });
    };
    const reweight = async () => {
        const invalid = typeof points !== 'number' || Number.isNaN(points);
        if (rubric.locked || invalid || points === cell.points)
            return;
        await commands.execute(CommandIDs.reweight, { id, points });
        if (assigned && typeof score === 'number' && !Number.isNaN(score)) {
            const manual = { comment, points: score, possible: points };
            const intervention = ___rspack_import_2.Rubric.Score.intervene(id, manual);
            await commands.execute(CommandIDs.intervene, { id, intervention });
        }
    };
    const sync = async () => {
        await commentate();
        await intervene();
    };
    return (react__rspack_import_0_default().createElement((react__rspack_import_0_default().Fragment), null,
        react__rspack_import_0_default().createElement("div", { "aria-live": "polite", className: "correxit-sidebar-cell-report", id: ids.heading },
            react__rspack_import_0_default().createElement("h5", null, heading),
            react__rspack_import_0_default().createElement("h5", null, subheading)),
        (!rubric.locked || (assigned && !!comment)) && (react__rspack_import_0_default().createElement("div", { "aria-labelledby": ids.heading, className: "correxit-sidebar-cell-score-edit", role: "group" },
            !rubric.locked && assigned && (react__rspack_import_0_default().createElement("label", { className: "correxit-sidebar-cell-score-field", htmlFor: ids.score },
                trans.__('Points scored'),
                react__rspack_import_0_default().createElement("input", { className: "correxit-sidebar-cell-score-input", id: ids.score, inputMode: "numeric", min: "0", onBlur: () => void intervene(), onChange: ({ target: { value } }) => setScore(whole(value)), placeholder: trans.__('Auto'), step: "1", type: "number", value: score }))),
            !rubric.locked && !derived && (react__rspack_import_0_default().createElement("label", { className: "correxit-sidebar-cell-score-field", htmlFor: ids.points },
                trans.__('Points possible'),
                react__rspack_import_0_default().createElement("input", { className: "correxit-sidebar-cell-score-input", id: ids.points, inputMode: "numeric", min: "0", onBlur: () => void reweight(), onChange: ({ target: { value } }) => setPoints(whole(value)), step: "1", type: "number", value: points }))),
            react__rspack_import_0_default().createElement(Comment, { ...{
                    comment,
                    id: ids.comment,
                    locked: rubric.locked,
                    setComment,
                    sync,
                    trans,
                    visible: assigned
                } })))));
};
const Comment = ({ comment, id, locked, setComment, sync, trans, visible }) => {
    if (!visible || (locked && !comment))
        return react__rspack_import_0_default().createElement((react__rspack_import_0_default().Fragment), null);
    return (react__rspack_import_0_default().createElement("details", { className: "correxit-sidebar-cell-score-comment" },
        react__rspack_import_0_default().createElement("summary", null, trans.__('Comment')),
        locked ? (react__rspack_import_0_default().createElement("p", { className: "correxit-sidebar-cell-score-guide" }, comment)) : (react__rspack_import_0_default().createElement("textarea", { className: "correxit-sidebar-cell-score-textarea", "data-lm-suppress-shortcuts": "true", id: id, name: "correxit-sidebar-cell-score-comment", onBlur: () => void sync(), onChange: ({ target: { value } }) => setComment(value), placeholder: trans.__('Cell comment...'), rows: 4, value: comment }))));
};


},
"./lib/ui/header.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Header: () => (Header)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/workbook.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var _assignment__rspack_import_6 = __webpack_require__("./lib/ui/assignment.js");
/* import */ var _trail__rspack_import_5 = __webpack_require__("./lib/ui/trail.js");





const { certify, collect, convert, distribute, draft, lock, revise, submit, unlock } = ___rspack_import_2.Correxit.CommandIDs;
const phase = (rubric, trans, unstarted) => {
    if (!rubric) {
        return {
            kind: trans.__('Notebook'),
            note: trans.__('Convert this notebook to begin authoring.'),
            tone: 'plain'
        };
    }
    const { assignment, locked } = rubric;
    if (!assignment.assignee) {
        return locked
            ? {
                kind: trans.__('Locked template'),
                note: trans.__('Unlock to continue authoring.'),
                tone: 'locked'
            }
            : {
                kind: trans.__('Template'),
                note: trans.__('Configure cells, roster, and deadline below.'),
                tone: 'template'
            };
    }
    if (assignment.collected !== null) {
        return {
            kind: trans.__('Collected'),
            note: trans.__('Grade receipt recorded.'),
            tone: 'collected'
        };
    }
    if (assignment.certification !== null) {
        return locked
            ? {
                kind: trans.__('Certified'),
                note: trans.__('Unlock to inspect or collect.'),
                tone: 'certified'
            }
            : {
                kind: trans.__('Ready to collect'),
                note: trans.__('Record the collection receipt.'),
                tone: 'certified'
            };
    }
    if (assignment.submission !== null) {
        if (assignment.seal !== null) {
            return {
                kind: trans.__('Sealed submission'),
                note: trans.__('Revision needs the submission passphrase.'),
                tone: 'submitted'
            };
        }
        return locked
            ? {
                kind: trans.__('Submitted'),
                note: trans.__('Keep it locked unless revision is needed.'),
                tone: 'submitted'
            }
            : {
                kind: trans.__('Open submission'),
                note: trans.__('Revert to draft or continue grading.'),
                tone: 'active'
            };
    }
    if (unstarted) {
        return assignment.distribution === null
            ? {
                kind: trans.__('Issued'),
                note: trans.__('Deliver this workbook next.'),
                tone: 'issued'
            }
            : {
                kind: trans.__('Distributed'),
                note: trans.__('The assignee can begin work.'),
                tone: 'issued'
            };
    }
    if (assignment.distribution !== null) {
        return {
            kind: trans.__('Distributed'),
            note: trans.__('Await submission.'),
            tone: 'issued'
        };
    }
    return locked
        ? {
            kind: trans.__('Locked'),
            note: trans.__('Unlock to inspect or continue.'),
            tone: 'locked'
        }
        : {
            kind: trans.__('Open workbook'),
            note: trans.__('Certify when grading is complete.'),
            tone: 'active'
        };
};
const step = (rubric, trans, distributable) => {
    if (!rubric) {
        return {
            body: trans.__('Convert this notebook to create a workbook.'),
            command: convert
        };
    }
    const { assignment, locked } = rubric;
    if (!assignment.assignee) {
        return locked
            ? {
                body: trans.__('Unlock to continue authoring.'),
                command: null
            }
            : {
                body: trans.__('Finish cell setup, roster, and deadline first.'),
                command: null
            };
    }
    if (distributable) {
        return {
            body: trans.__('Record delivery before treating this as student work.'),
            command: distribute
        };
    }
    if (!locked && assignment.certification !== null && !assignment.collected) {
        return {
            body: trans.__('Record the certified grade.'),
            command: collect
        };
    }
    if (!locked && assignment.certification === null) {
        return {
            body: trans.__('Certify when every graded cell is resolved.'),
            command: certify
        };
    }
    if (assignment.submission !== null && assignment.seal !== null) {
        return {
            body: trans.__('Use the submission passphrase to revise.'),
            command: revise
        };
    }
    if (assignment.submission !== null) {
        return {
            body: trans.__('Revert to draft only if editing must resume.'),
            command: draft
        };
    }
    if (locked &&
        assignment.assignee &&
        assignment.distribution !== null &&
        assignment.certification === null) {
        return {
            body: trans.__('Submit when the assignee is finished.'),
            command: submit
        };
    }
    if (assignment.certification !== null) {
        return {
            body: trans.__('Unlock to inspect or collect.'),
            command: null
        };
    }
    return {
        body: trans.__('Continue working.'),
        command: null
    };
};
const Header = ({ commands, trans, workbook }) => {
    const rubric = workbook ? ___rspack_import_3.Workbook.open(workbook, true) : null;
    const unstarted = useUnstarted(workbook, rubric);
    if (!workbook) {
        return (react__rspack_import_1_default().createElement("section", { "aria-label": trans.__('Workbook summary'), className: "correxit-sidebar-header" },
            react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-inner-header" },
                react__rspack_import_1_default().createElement("h4", null, trans.__('Correxit: idle'))),
            react__rspack_import_1_default().createElement("p", null, trans.__('Open a notebook to inspect its state.'))));
    }
    const score = rubric
        ? ___rspack_import_4.Rubric.Assignment.summary(rubric.assignment.report, rubric.assignment)
        : null;
    const assignment = (rubric === null || rubric === void 0 ? void 0 : rubric.assignment) || null;
    const heading = rubric ? trans.__('Workbook') : trans.__('Notebook');
    const scored = !!score &&
        score.status !== 'unscored' &&
        Number.isFinite(score.points) &&
        Number.isFinite(score.possible);
    const titled = scored
        ? trans.__('%1 (%2 of %3)', heading, score.points, score.possible)
        : heading;
    const distributable = assignment !== null &&
        ___rspack_import_4.Rubric.Assignment.issued(assignment) &&
        assignment.distribution === null;
    const view = phase(rubric, trans, unstarted);
    const next = step(rubric, trans, distributable);
    const lines = assignment ? (0,_trail__rspack_import_5.trail)(assignment, trans) : [];
    if (unstarted)
        lines.push(trans.__('Unstarted'));
    const line = lines.at(-1) || '';
    const title = lines.join('\n');
    return (react__rspack_import_1_default().createElement("section", { "aria-label": trans.__('Workbook summary'), className: "correxit-sidebar-header" },
        react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-inner-header" },
            react__rspack_import_1_default().createElement("h4", null, titled),
            react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-lock-controls" },
                react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { commands: commands, id: lock }),
                react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { commands: commands, id: unlock }))),
        react__rspack_import_1_default().createElement("div", { className: `correxit-sidebar-phase cxt-mod-${view.tone}` },
            react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-phase-bar" },
                react__rspack_import_1_default().createElement("span", { className: "correxit-sidebar-phase-label" }, trans.__('Phase')),
                react__rspack_import_1_default().createElement("span", { className: "correxit-sidebar-phase-chip" }, view.kind)),
            react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-phase-copy" }, view.note),
            !!line && (react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-phase-tail", title: title || undefined }, line))),
        !!rubric && react__rspack_import_1_default().createElement(_assignment__rspack_import_6.Assignment, { ...{ commands, trans, workbook } }),
        react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-next" },
            react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-next-copy" },
                react__rspack_import_1_default().createElement("span", { className: "correxit-sidebar-next-label" }, trans.__('Next')),
                react__rspack_import_1_default().createElement("span", { className: "correxit-sidebar-next-body" }, next.body)),
            next.command && (react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-next-actions" },
                react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { commands: commands, id: next.command }))))));
};
function useUnstarted(workbook, rubric) {
    const [unstarted, setUnstarted] = (0,react__rspack_import_1.useState)(false);
    const assignment = rubric === null || rubric === void 0 ? void 0 : rubric.assignment;
    const needed = !!(assignment &&
        ___rspack_import_4.Rubric.Assignment.issued(assignment) &&
        assignment.certification === null &&
        assignment.collected === null &&
        assignment.distribution === null &&
        assignment.submission === null &&
        assignment.submitted === null);
    (0,react__rspack_import_1.useEffect)(() => {
        if (!workbook || !needed) {
            setUnstarted(false);
            return;
        }
        let canceled = false;
        void ___rspack_import_3.Workbook.unstarted(workbook)
            .then(unstarted => !canceled && setUnstarted(unstarted))
            .catch(() => !canceled && setUnstarted(false));
        return () => void (canceled = true);
    }, [needed, workbook]);
    return unstarted;
}


},
"./lib/ui/propagator.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Propagator: () => (Propagator)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _correxit_use_command__rspack_import_3 = __webpack_require__("./lib/correxit/use-command.js");




class PropagatorWidget extends _jupyterlab_ui_components__rspack_import_0.ReactWidget {
    constructor(options) {
        super();
        this.options = options;
        this.addClass('correxit-propagator');
    }
    dispose() {
        this.options.release();
        super.dispose();
    }
    onCloseRequest(msg) {
        super.onCloseRequest(msg);
        this.options.refocus();
    }
    render() {
        const close = () => this.close();
        const title = this.title.caption;
        return react__rspack_import_1_default().createElement(Propagator, { ...{ ...this.options, close, title } });
    }
}
function Propagator(props) {
    var _a;
    const { close, commands, overwrite, release, title, trans } = props;
    const { propagate, redistribute } = ___rspack_import_2.Correxit.CommandIDs;
    const [canceled, setCanceled] = (0,react__rspack_import_1.useState)(false);
    const [archived, setArchived] = (0,react__rspack_import_1.useState)(null);
    const command = canceled ? '' : propagate;
    const [timestamp] = (0,react__rspack_import_1.useState)(Date.now);
    const args = { overwrite, timestamp };
    const [log, done] = (0,_correxit_use_command__rspack_import_3.useCommand)(commands, command, args);
    const [attempted, setAttempted] = (0,react__rspack_import_1.useState)(false);
    const [retry, setRetry] = (0,react__rspack_import_1.useState)(null);
    const [retries, setRetries] = (0,react__rspack_import_1.useState)([]);
    const [started, setStarted] = (0,react__rspack_import_1.useState)(false);
    const recover = retry ? redistribute : '';
    const [extra, idle] = (0,_correxit_use_command__rspack_import_3.useCommand)(commands, recover, retry || {});
    (0,react__rspack_import_1.useEffect)(() => void (command && setAttempted(true)), [command]);
    (0,react__rspack_import_1.useEffect)(() => {
        if (done && attempted)
            release();
    }, [attempted, done, release]);
    (0,react__rspack_import_1.useEffect)(() => {
        if (!retry) {
            setStarted(false);
            return;
        }
        if (!idle || extra.length)
            setStarted(true);
    }, [extra.length, idle, retry]);
    (0,react__rspack_import_1.useEffect)(() => {
        if (!retry || !started || !idle)
            return;
        setRetries(current => [...current, ...extra]);
        setRetry(null);
    }, [extra, idle, retry, started]);
    const retrying = !!retry;
    const trail = [...log, ...retries, ...(retry ? extra : [])];
    const record = archived !== null && archived !== void 0 ? archived : trail;
    const messages = record
        .filter(([, { type }]) => type !== 'progress')
        .map(([message]) => message);
    const directory = (_a = record.find(([, { type }]) => type === 'mkdir')) === null || _a === void 0 ? void 0 : _a[1].slots[0];
    const saved = new Set(record
        .filter(([, { type }]) => type === 'saved')
        .map(([, { slots }]) => slots[0]));
    const failed = Array.from(new Set(record
        .filter(([, { type }]) => type === 'distribute-error')
        .map(([, { slots }]) => slots[1])
        .filter(path => saved.has(path))));
    const start = retries
        .map(([, { type }]) => type === 'separator')
        .lastIndexOf(true);
    const recent = start === -1 ? [] : retries.slice(start);
    const retried = Array.from(new Set(recent
        .filter(([, { type }]) => type === 'distribute-error')
        .map(([, { slots }]) => slots[1])));
    const pending = retries.length ? retried : failed;
    const active = retrying ? extra : log;
    const [value, max] = active.reduce((progress, [, { type, slots }]) => type === 'progress' ? slots : progress, [0, 1]);
    const percent = max > 0 ? Math.round((value / max) * 100) : 0;
    const running = !done || retrying;
    const retriable = done && (!!pending.length || retrying);
    const redo = () => {
        if (retrying || !directory || !pending.length)
            return;
        setRetry({ path: directory, timestamp: Date.now() });
    };
    const cancel = () => {
        setArchived(trail);
        setCanceled(true);
    };
    return (react__rspack_import_1_default().createElement("div", { "aria-busy": running, className: "correxit-propagator-content" },
        react__rspack_import_1_default().createElement("div", { className: "correxit-propagator-header" },
            react__rspack_import_1_default().createElement("span", { className: "correxit-propagator-title" }, title),
            react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.ToolbarButtonComponent, { icon: _jupyterlab_ui_components__rspack_import_0.closeIcon, onClick: close, tooltip: trans.__('Close'), noFocusOnClick: true })),
        react__rspack_import_1_default().createElement(Log, { ...{ done, messages, trans } }),
        done && canceled && (react__rspack_import_1_default().createElement("span", { className: "correxit-propagator-notice", role: "status" }, trans.__('Canceled.'))),
        done && !canceled && !messages.length && (react__rspack_import_1_default().createElement("span", { className: "correxit-propagator-notice", role: "status" }, trans.__('No workbooks were created.'))),
        running && (react__rspack_import_1_default().createElement("div", { className: "correxit-propagator-controls" },
            react__rspack_import_1_default().createElement("div", { className: "correxit-propagator-progress" },
                react__rspack_import_1_default().createElement("progress", { "aria-label": trans.__('Propagation progress'), ...{ max, value } }),
                react__rspack_import_1_default().createElement("span", null, trans.__('%1%', percent))),
            !retrying && (react__rspack_import_1_default().createElement("button", { className: "correxit-propagator-button correxit-propagator-cancel", onClick: cancel }, trans.__('Cancel'))))),
        retriable && (react__rspack_import_1_default().createElement("div", { className: "correxit-propagator-controls" },
            react__rspack_import_1_default().createElement("button", { className: "correxit-propagator-button correxit-propagator-retry", disabled: retrying, onClick: redo }, retrying
                ? trans.__('Retrying...')
                : trans.__('Retry %1 failed', pending.length))))));
}
(function (Propagator) {
    Propagator.Widget = PropagatorWidget;
})(Propagator || (Propagator = {}));
const Log = ({ done, messages, trans }) => {
    const ref = (0,react__rspack_import_1.useRef)(null);
    (0,react__rspack_import_1.useEffect)(() => {
        if (ref.current)
            ref.current.scrollTop = ref.current.scrollHeight;
    }, [messages.length]);
    if (done && !messages.length)
        return null;
    return (react__rspack_import_1_default().createElement("pre", { "aria-atomic": "false", "aria-busy": !done, "aria-label": trans.__('Propagation log'), "aria-live": "polite", "aria-relevant": "additions text", ref: ref, role: "log" }, messages.map((message, key) => (react__rspack_import_1_default().createElement(Emission, { ...{ key, message } })))));
};
const Emission = react__rspack_import_1_default().memo(({ message }) => (react__rspack_import_1_default().createElement("span", { title: message },
    message,
    react__rspack_import_1_default().createElement("br", null))));


},
"./lib/ui/references.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  References: () => (References)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/correxit/rubric.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/correxit/workbook.js");



const { dereference, refer } = ___rspack_import_2.Correxit.CommandIDs;
const { get } = ___rspack_import_3.Rubric;
const References = ({ commands, id, rubric, trans, workbook }) => {
    const cell = get(rubric, id);
    if (!cell)
        return react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null);
    if (cell.is !== 'comparable' && cell.is !== 'correctable')
        return react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null);
    const references = Object.values(rubric.references).filter(reference => reference.cell === id);
    if (!references.length && rubric.locked)
        return react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null);
    const correctable = cell.is === 'correctable';
    const editable = !rubric.locked && !rubric.assignment.assignee;
    const notebook = ___rspack_import_4.Workbook.headed(workbook) ? workbook.content : null;
    const source = (referent) => {
        var _a;
        const cell = notebook === null || notebook === void 0 ? void 0 : notebook.widgets.find(({ model }) => model.id === referent);
        return (_a = cell === null || cell === void 0 ? void 0 : cell.model.sharedModel.getSource().split('\n')[0]) !== null && _a !== void 0 ? _a : '';
    };
    const scroll = (referent) => {
        if (!notebook)
            return;
        const cell = notebook.widgets.find(({ model }) => model.id === referent);
        if (cell)
            void notebook.scrollToCell(cell);
    };
    const sources = references.map(reference => ({
        ...reference,
        source: source(reference.referent)
    }));
    return (react__rspack_import_1_default().createElement("div", { className: "correxit-sidebar-references" },
        react__rspack_import_1_default().createElement("h5", null, trans.__('References (%1)', references.length)),
        react__rspack_import_1_default().createElement("ul", { className: "correxit-sidebar-references-list" }, sources.map(({ points, referent, source }) => (react__rspack_import_1_default().createElement("li", { className: "correxit-sidebar-reference-item", key: referent },
            react__rspack_import_1_default().createElement("button", { className: "correxit-sidebar-reference-locate", onClick: () => scroll(referent), title: referent, type: "button" }, referent.slice(0, 4)),
            react__rspack_import_1_default().createElement("span", { className: "correxit-sidebar-reference-source", title: source }, source),
            correctable && (react__rspack_import_1_default().createElement("span", { className: 'correxit-sidebar-reference-points', title: trans.__('Points') }, trans.__('%1pt', points))),
            editable && (react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{
                    args: { referent },
                    commands,
                    id: dereference,
                    label: ''
                } })))))),
        editable && (react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { ...{ args: { id }, commands, id: refer } }))));
};


},
"./lib/ui/sidebar.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  Sidebar: () => (Sidebar)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var ___rspack_import_2 = __webpack_require__("./lib/correxit/correxit.js");
/* import */ var _annotate__rspack_import_3 = __webpack_require__("./lib/ui/annotate.js");
/* import */ var _body__rspack_import_5 = __webpack_require__("./lib/ui/body.js");
/* import */ var _header__rspack_import_4 = __webpack_require__("./lib/ui/header.js");
/* import */ var _widget__rspack_import_6 = __webpack_require__("./lib/ui/widget.js");







const { reset } = ___rspack_import_2.Correxit.CommandIDs;
function Sidebar(props) {
    const { annotate, commands, trans, workbook } = props;
    return (react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null,
        react__rspack_import_1_default().createElement(_annotate__rspack_import_3.Annotate, { ...{ workbook: annotate ? workbook : null } }),
        react__rspack_import_1_default().createElement(_header__rspack_import_4.Header, { ...{ commands, trans, workbook } }),
        workbook && (react__rspack_import_1_default().createElement((react__rspack_import_1_default().Fragment), null,
            react__rspack_import_1_default().createElement(_body__rspack_import_5.Body, { ...{ commands, trans, workbook } }),
            react__rspack_import_1_default().createElement("section", { "aria-label": trans.__('Sidebar actions'), className: "correxit-sidebar-footer" },
                react__rspack_import_1_default().createElement(_jupyterlab_ui_components__rspack_import_0.CommandToolbarButtonComponent, { commands: commands, id: reset }))))));
}
(function (Sidebar) {
    Sidebar.Widget = _widget__rspack_import_6.SidebarWidget;
})(Sidebar || (Sidebar = {}));


},
"./lib/ui/trail.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  trail: () => (trail)
});
/* import */ var ___rspack_import_0 = __webpack_require__("./lib/correxit/rubric.js");

/** @returns chronological assignment lifecycle entries for display. */
function trail(assignment, trans) {
    const { certification, collected, distribution, submission, submitted } = assignment;
    const lines = [];
    if (distribution !== null)
        lines.push(trans.__('Distribution %1', ___rspack_import_0.Rubric.timestamp(distribution)));
    if (submission !== null)
        lines.push(trans.__('Submission %1', ___rspack_import_0.Rubric.timestamp(submission)));
    if (submitted !== null)
        lines.push(trans.__('Submitted: %1', submitted));
    if (certification !== null)
        lines.push(trans.__('Certification %1', ___rspack_import_0.Rubric.timestamp(certification)));
    if (collected !== null)
        lines.push(trans.__('Collected: %1', collected));
    return lines;
}


},
"./lib/ui/widget.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  SidebarWidget: () => (SidebarWidget)
});
/* import */ var _jupyterlab_ui_components__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@jupyterlab/ui-components");
/* import */ var _jupyterlab_ui_components__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__rspack_import_0);
/* import */ var react__rspack_import_1 = __webpack_require__("webpack/sharing/consume/default/react");
/* import */ var react__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(react__rspack_import_1);
/* import */ var _correxit_state__rspack_import_2 = __webpack_require__("./lib/correxit/state.js");
/* import */ var ___rspack_import_3 = __webpack_require__("./lib/ui/boundary.js");
/* import */ var ___rspack_import_4 = __webpack_require__("./lib/ui/sidebar.js");




class SidebarWidget extends _jupyterlab_ui_components__rspack_import_0.ReactWidget {
    constructor({ commands, monitor, settings, trans }) {
        super();
        this.annotate = true;
        this.active = null;
        this.addClass('correxit-sidebar');
        this.commands = commands;
        this.trans = trans;
        _correxit_state__rspack_import_2.refreshed.connect(this.update, this);
        void this.initialize(settings);
        void this.subscribe(monitor);
    }
    get workbook() {
        return this.active;
    }
    set workbook(workbook) {
        var _a, _b;
        const previous = this.workbook;
        if (workbook === previous)
            return;
        this.active = workbook;
        if (workbook) {
            const model = workbook.context.model;
            const notebook = workbook.context.model.sharedModel;
            model.cells.changed.connect(this.update, this);
            notebook.metadataChanged.connect(this.update, this);
            workbook.context.fileChanged.connect(this.update, this);
            (_a = workbook.content) === null || _a === void 0 ? void 0 : _a.activeCellChanged.connect(this.update, this);
        }
        if (previous && !previous.context.isDisposed) {
            const model = previous.context.model;
            const notebook = previous.context.model.sharedModel;
            model.cells.changed.disconnect(this.update, this);
            notebook.metadataChanged.disconnect(this.update, this);
            previous.context.fileChanged.disconnect(this.update, this);
            (_b = previous.content) === null || _b === void 0 ? void 0 : _b.activeCellChanged.disconnect(this.update, this);
        }
        this.update();
    }
    async initialize(pending) {
        const settings = await pending;
        if (settings) {
            settings.changed.connect(({ composite }) => void (this.annotate = !!composite.annotate));
            this.annotate = !!settings.composite.annotate;
        }
    }
    render() {
        const { annotate, commands, trans, workbook } = this;
        const label = trans.__('Something went wrong rendering the sidebar.');
        const key = workbook ? workbook.context.path : 'idle';
        return (react__rspack_import_1_default().createElement(___rspack_import_3.Boundary, { key: key, label: label },
            react__rspack_import_1_default().createElement(___rspack_import_4.Sidebar, { ...{ annotate, commands, trans, workbook } })));
    }
    async subscribe(monitor) {
        for await (const workbook of monitor) {
            if (this.isDisposed)
                return;
            this.workbook = workbook;
        }
    }
}


},
"./style/brand/correxit-mark-jupyter.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" aria-hidden=\"true\" focusable=\"false\">\n  <g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path class=\"jp-icon3\" d=\"M98 54H54v148h44M180 54h44M202 54v120M158 202h44\" stroke=\"#616161\" stroke-width=\"18\"/>\n    <path class=\"jp-icon3\" d=\"M107.5 150l25 25\" stroke=\"#616161\" stroke-width=\"20\"/>\n    <path d=\"m83.5 126 33 33 56-56\" stroke=\"#ef5b45\" stroke-width=\"20\"/>\n  </g>\n</svg>\n";

},
"./style/monitor/icons/answerable.svg?4f5b"(module) {
module.exports = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0_65_2143)\">\n<path d=\"M13.9997 3.99999H12.6663V9.99999H3.99967V11.3333C3.99967 11.7 4.29967 12 4.66634 12H11.9997L14.6663 14.6667V4.66666C14.6663 4.29999 14.3663 3.99999 13.9997 3.99999ZM11.333 7.99999V1.99999C11.333 1.63333 11.033 1.33333 10.6663 1.33333H1.99967C1.63301 1.33333 1.33301 1.63333 1.33301 1.99999V11.3333L3.99967 8.66666H10.6663C11.033 8.66666 11.333 8.36666 11.333 7.99999Z\" fill=\"white\"/>\n</g>\n<defs>\n<clipPath id=\"clip0_65_2143\">\n<rect width=\"16\" height=\"16\" fill=\"white\"/>\n</clipPath>\n</defs>\n</svg>\n";

},
"./style/monitor/icons/assignee.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M216-144q-29.7 0-50.85-21.15Q144-186.3 144-216v-528q0-29.7 21.15-50.85Q186.3-816 216-816h171q8-32 34.03-52t59-20Q513-888 539-868t34 52h171q29.7 0 50.85 21.15Q816-773.7 816-744v528q0 29.7-21.15 50.85Q773.7-144 744-144H216Zm264-624q10.4 0 17.2-6.8 6.8-6.8 6.8-17.2 0-10.4-6.8-17.2-6.8-6.8-17.2-6.8-10.4 0-17.2 6.8-6.8 6.8-6.8 17.2 0 10.4 6.8 17.2 6.8 6.8 17.2 6.8ZM216-269q56-46 124-68.5T480-360q72 0 140 22t124 69v-475H216v475Zm264.24-139Q540-408 582-450.24q42-42.24 42-102T581.76-654q-42.24-42-102-42T378-653.76q-42 42.24-42 102T378.24-450q42.24 42 102 42ZM265-216h430q-46-35-101-53.5T480-288q-59 0-113.5 18.5T265-216Zm215-264q-30 0-51-21t-21-51q0-30 21-51t51-21q30 0 51 21t21 51q0 30-21 51t-51 21Zm0-72Z\"/>\n</svg>\n";

},
"./style/monitor/icons/assignment.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M216-144q-29.7 0-50.85-21.15Q144-186.3 144-216v-528q0-29.7 21.15-50.85Q186.3-816 216-816h171q8-31 33.5-51.5T480-888q34 0 59.5 20.5T573-816h171q29.7 0 50.85 21.15Q816-773.7 816-744v528q0 29.7-21.15 50.85Q773.7-144 744-144H216Zm0-72h528v-528H216v528Zm72-72h288v-72H288v72Zm0-156h384v-72H288v72Zm0-156h384v-72H288v72Zm192-168q10.4 0 17.2-6.8 6.8-6.8 6.8-17.2 0-10.4-6.8-17.2-6.8-6.8-17.2-6.8-10.4 0-17.2 6.8-6.8 6.8-6.8 17.2 0 10.4 6.8 17.2 6.8 6.8 17.2 6.8ZM216-216v-528 528Z\"/>\n</svg>\n";

},
"./style/monitor/icons/certify.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\" width=\"16px\" fill=\"#e3e3e3\"><path d=\"m480-432 312-179v-85L480-517 168-696v85l312 179Zm264 240q-10.2 0-17.1-6.9-6.9-6.9-6.9-17.1v-144q0-10.2 6.9-17.1 6.9-6.9 17.1-6.9h24v-48q0-29.7 21.21-50.85 21.21-21.15 51-21.15T891-482.85q21 21.15 21 50.85v48h24q10.2 0 17.1 6.9 6.9 6.9 6.9 17.1v144q0 10.2-6.9 17.1-6.9 6.9-17.1 6.9H744Zm60-192h72v-48q0-15.3-10.29-25.65Q855.42-468 840.21-468t-25.71 10.35Q804-447.3 804-432v48ZM168-192q-29.7 0-50.85-21.16Q96-234.32 96-264.04v-432.24Q96-726 117.15-747T168-768h624q29.7 0 50.85 21.15Q864-725.7 864-696v144h-32q-76.36 0-130.18 52.65Q648-446.7 648-372v180H168Z\"/></svg>\n";

},
"./style/monitor/icons/comment.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\" width=\"16px\" fill=\"#FFFFFF\"><path d=\"M240-384h480v-72H240v72Zm0-132h480v-72H240v72Zm0-132h480v-72H240v72ZM864-96 720-240H168q-29.7 0-50.85-21.15Q96-282.3 96-312v-480q0-29.7 21.15-50.85Q138.3-864 168-864h624q29.7 0 50.85 21.15Q864-821.7 864-792v696ZM168-312h582l42 42v-522H168v480Zm0 0v-480 480Z\"/></svg>";

},
"./style/monitor/icons/comparable.svg?7fe7"(module) {
module.exports = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M10.1997 8.86667L7.79967 6.46667C7.73301 6.4 7.6859 6.32778 7.65834 6.25C7.63034 6.17222 7.61634 6.08889 7.61634 6C7.61634 5.91111 7.63034 5.82778 7.65834 5.75C7.6859 5.67222 7.73301 5.6 7.79967 5.53333L10.1997 3.13333C10.333 3 10.4886 2.93333 10.6663 2.93333C10.8441 2.93333 10.9997 3 11.133 3.13333C11.2663 3.26667 11.333 3.42489 11.333 3.608C11.333 3.79156 11.2663 3.95 11.133 4.08333L9.88301 5.33333H13.9997C14.1886 5.33333 14.3468 5.39711 14.4743 5.52467C14.6023 5.65267 14.6663 5.81111 14.6663 6C14.6663 6.18889 14.6023 6.34711 14.4743 6.47467C14.3468 6.60267 14.1886 6.66667 13.9997 6.66667H9.88301L11.133 7.91667C11.2663 8.05 11.333 8.20556 11.333 8.38333C11.333 8.56111 11.2663 8.71667 11.133 8.85C10.9997 8.98333 10.847 9.05556 10.675 9.06667C10.5026 9.07778 10.3441 9.01111 10.1997 8.86667ZM4.86634 12.85C4.99967 12.9833 5.15523 13.0527 5.33301 13.058C5.51079 13.0638 5.66634 13 5.79967 12.8667L8.19967 10.4667C8.26634 10.4 8.31367 10.3278 8.34167 10.25C8.36923 10.1722 8.38301 10.0889 8.38301 10C8.38301 9.91111 8.36923 9.82778 8.34167 9.75C8.31367 9.67222 8.26634 9.6 8.19967 9.53333L5.79967 7.13333C5.66634 7 5.51079 6.93333 5.33301 6.93333C5.15523 6.93333 4.99967 7 4.86634 7.13333C4.73301 7.26667 4.66634 7.42489 4.66634 7.608C4.66634 7.79156 4.73301 7.95 4.86634 8.08333L6.11634 9.33333H1.99967C1.81079 9.33333 1.65256 9.39711 1.52501 9.52467C1.39701 9.65267 1.33301 9.81111 1.33301 10C1.33301 10.1889 1.39701 10.3471 1.52501 10.4747C1.65256 10.6027 1.81079 10.6667 1.99967 10.6667H6.11634L4.86634 11.9167C4.73301 12.05 4.66634 12.2056 4.66634 12.3833C4.66634 12.5611 4.73301 12.7167 4.86634 12.85Z\" fill=\"white\"/>\n</svg>\n";

},
"./style/monitor/icons/convert.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M192-144v-672h576v384H264v72h168v72H264v72h168v72H192Zm406 0L496-246l51-51 51 51 119-119 51 51-170 170ZM264-504h180v-84H264v84Zm252 0h180v-84H516v84ZM264-660h180v-84H264v84Zm252 0h180v-84H516v84Z\"/>\n</svg>\n";

},
"./style/monitor/icons/correct.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"none\" class=\"jp-icon4\" d=\"m576-160-56-56 104-104-104-104 56-56 104 104 104-104 56 56-104 104 104 104-56 56-104-104-104 104Zm79-360L513-662l56-56 85 85 170-170 56 57-225 226ZM80-280v-80h360v80H80Zm0-320v-80h360v80H80Z\"/>\n</svg>\n";

},
"./style/monitor/icons/correctable.svg?4f33"(module) {
module.exports = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M7.99967 1.33334C4.31767 1.33334 1.33301 4.318 1.33301 8C1.33301 11.682 4.31767 14.6667 7.99967 14.6667C11.6817 14.6667 14.6663 11.682 14.6663 8C14.6663 4.318 11.6817 1.33334 7.99967 1.33334ZM6.66634 11.6093L3.52834 8.47134L4.47101 7.52867L6.66634 9.724L11.5283 4.862L12.471 5.80467L6.66634 11.6093Z\" fill=\"white\"/>\n</svg>\n";

},
"./style/monitor/icons/kernel.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M384-384v-192h192v192H384Zm72-72h48v-48h-48v48Zm-96 312v-96h-48q-29 0-50.5-21.5T240-312v-48h-96v-72h96v-96h-96v-72h96v-48q0-29 21.5-50.5T312-720h48v-96h72v96h96v-96h72v96h48q29 0 50.5 21.5T720-648v48h96v72h-96v96h96v72h-96v48q0 29-21.5 50.5T648-240h-48v96h-72v-96h-96v96h-72Zm288-168v-336H312v336h336ZM480-480Z\"/>\n</svg>\n";

},
"./style/monitor/icons/key.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M408-672q0-40 28-68t68-28q40 0 68 28t28 68q0 40-28 68t-68 28q-40 0-68-28t-28-68ZM504 0 336-180l60-84-60-72 72-96v-20q-68-32-106-89.5T264-672q0-100 70-170t170-70q100 0 170 70t70 170q0 65-32.5 120T624-464v344L504 0ZM336-672q0 63 40.5 110.5T480-506v98l-52 70 59 71-58 81 76 82 47-46v-361q53-16 86.5-61T672-672q0-70-49-119t-119-49q-70 0-119 49t-49 119Z\"/>\n</svg>\n";

},
"./style/monitor/icons/locked.svg?3194"(module) {
module.exports = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0_65_2923)\">\n<path d=\"M12 17C13.1 17 14 16.1 14 15C14 13.9 13.1 13 12 13C10.9 13 10 13.9 10 15C10 16.1 10.9 17 12 17ZM18 8H17V6C17 3.24 14.76 1 12 1C9.24 1 7 3.24 7 6V8H6C4.9 8 4 8.9 4 10V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V10C20 8.9 19.1 8 18 8ZM8.9 6C8.9 4.29 10.29 2.9 12 2.9C13.71 2.9 15.1 4.29 15.1 6V8H8.9V6ZM18 20H6V10H18V20Z\" fill=\"currentColor\"/>\n</g>\n<defs>\n<clipPath id=\"clip0_65_2923\">\n<rect width=\"24\" height=\"24\" fill=\"currentColor\"/>\n</clipPath>\n</defs>\n</svg>\n";

},
"./style/monitor/icons/remove.svg"(module) {
module.exports = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0_65_2886)\">\n<path d=\"M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM17 13H7V11H17V13Z\" fill=\"none\" class=\"jp-icon4\"/>\n</g>\n<defs>\n<clipPath id=\"clip0_65_2886\">\n<rect width=\"24\" height=\"24\" fill=\"none\" class=\"jp-icon4\"/>\n</clipPath>\n</defs>\n</svg>\n";

},
"./style/monitor/icons/reviewable.svg?5136"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\" width=\"16px\" fill=\"none\">\n<path d=\"M240-400h122l200-200q9-9 13.5-20.5T580-643q0-11-5-21.5T562-684l-36-38q-9-9-20-13.5t-23-4.5q-11 0-22.5 4.5T440-722L240-522v122Zm280-243-37-37 37 37ZM300-460v-38l101-101 20 18 18 20-101 101h-38Zm121-121 18 20-38-38 20 18Zm26 181h273v-80H527l-80 80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z\" fill=\"white\"/>\n</svg>\n";

},
"./style/monitor/icons/roster.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M216-144q-29.7 0-50.85-21.15Q144-186.3 144-216v-528q0-29.7 21.15-50.85Q186.3-816 216-816h171q8-31 33.5-51.5T480-888q34 0 59.5 20.5T573-816h171q29.7 0 50.85 21.15Q816-773.7 816-744v258q-17.1-5.76-35.1-9.92T744-502v-242H216v528h241q1.88 19.52 5.94 37.26Q467-161 473-144H216Zm0-96v24-528 242-2 264Zm72-48h172q4-19 10.19-36.97Q476.38-342.93 484-360H288v72Zm0-156h264q26-20 56-34.5t64-20.5v-17H288v72Zm0-156h384v-72H288v72Zm192-168q10.4 0 17.2-6.8 6.8-6.8 6.8-17.2 0-10.4-6.8-17.2-6.8-6.8-17.2-6.8-10.4 0-17.2 6.8-6.8 6.8-6.8 17.2 0 10.4 6.8 17.2 6.8 6.8 17.2 6.8ZM719.77-48Q640-48 584-104.23q-56-56.22-56-136Q528-320 584.23-376q56.22-56 136-56Q800-432 856-375.77q56 56.22 56 136Q912-160 855.77-104q-56.22 56-136 56ZM696-144h48v-72h72v-48h-72v-72h-48v72h-72v48h72v72Z\"/>\n</svg>\n";

},
"./style/monitor/icons/secret.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M422-360h116l-22-129q16.74-8.94 26.37-25.93 9.63-16.99 9.63-37.56Q552-582 530.79-603q-21.21-21-51-21T429-602.85Q408-581.7 408-552q0 20.41 9.63 37.27Q427.26-497.87 444-489l-22 129Zm58 264q-135-33-223.5-152.84Q168-368.69 168-515v-229l312-120 312 120v229q0 146.31-88.5 266.16Q615-129 480-96Zm0-75q104-32.25 172-129t68-215v-180l-240-92-240 92v180q0 118.25 68 215t172 129Zm0-308Z\"/>\n</svg>\n";

},
"./style/monitor/icons/shared.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M543.52-518q4.48-8 6.48-16.54t2-17.53q0-29.67-21.25-50.8Q509.5-624 479.95-624q-8.95 0-17.45 2.5t-16.5 6.93L543.52-518ZM744-317l-54-55q15-35 22.5-71.5T720-515v-179l-240-92-148 56-56-55 204-79 312 120v229q0 50.32-12 99.66Q768-366 744-317Zm25 228L660-198q-36 36-81.5 62T480-96q-137-35-224.5-153T168-515v-175l-78-78 51-51 679 679-51 51ZM433-425Zm49-154Zm-2 408q38-13 70.5-33t57.5-46L498-360h-76l11-65-193-193v103q0 116.45 65.5 211.72Q371-208 480-171Z\"/>\n</svg>\n";

},
"./style/monitor/icons/template.svg"(module) {
module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" height=\"16px\" viewBox=\"0 -960 960 960\">\n  <path fill=\"#333\" class=\"jp-icon4\" d=\"M611-493 421-683q14-8 28.5-10.5T480-696q60 0 102 42t42 102q0 16-2.5 30.5T611-493ZM237-285q54-37 115.5-56t127.05-19q17.1 0 32.78 1.5Q528-357 545-355l-54-54q-67 7-114-40.5T337-563L232-668q-31 41-47.5 89T168-479.87Q168-426 185-376q17 50 52 91Zm483 4q34-43 53-93.5t19-105.31Q792-610 700.84-701 609.67-792 480-792q-55 0-106 18.5T281-720l439 439ZM480-96q-78.72 0-148.8-30.24-70.08-30.24-122.4-82.56-52.32-52.32-82.56-122.4Q96-401.28 96-480q0-79.68 30.24-149.28T208.8-751.2q52.32-52.32 122.4-82.56Q401.28-864 480-864q79.68 0 149.28 30.24T751.2-751.2q52.32 52.32 82.56 121.92Q864-559.68 864-480q0 78.72-30.24 148.8-30.24 70.08-82.56 122.4-52.32 52.32-121.92 82.56Q559.68-96 480-96Zm-.5-72q51.5 0 99.5-16.5t89-47.5q-42-29-89.5-42.5T480-288q-51 0-99.5 13.5T290-233q42 32 90 48.5t99.5 16.5Zm.5-59Z\"/>\n</svg>\n";

},
"./style/monitor/icons/unlocked.svg"(module) {
module.exports = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0_65_2112)\">\n<path d=\"M12 17C13.1 17 14 16.1 14 15C14 13.9 13.1 13 12 13C10.9 13 10 13.9 10 15C10 16.1 10.9 17 12 17ZM18 8H17V6C17 3.24 14.76 1 12 1C9.24 1 7 3.24 7 6H8.9C8.9 4.29 10.29 2.9 12 2.9C13.71 2.9 15.1 4.29 15.1 6V8H6C4.9 8 4 8.9 4 10V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V10C20 8.9 19.1 8 18 8ZM18 20H6V10H18V20Z\" fill=\"currentColor\"/>\n</g>\n<defs>\n<clipPath id=\"clip0_65_2112\">\n<rect width=\"24\" height=\"24\" fill=\"currentColor\"/>\n</clipPath>\n</defs>\n</svg>\n";

},

}]);
//# sourceMappingURL=lib_index_js.6958f83bef76f736.js.map