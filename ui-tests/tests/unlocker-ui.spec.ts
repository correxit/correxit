import { expect, test } from './fixtures';
import { cleanup, setup } from './utils';

test.use({ autoGoto: false });

test('a hosted unlocker supports the full lifecycle without passphrases', async ({
  page
}) => {
  const { dispose } = await setup(page, [
    { id: 'answer', source: 'student answer' },
    { id: 'reference', source: 'secret reference' }
  ]);

  const result = await page.evaluate(async () => {
    const { Correxit, Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
    const previous = { ...unlocker };
    const author = 'ab'.repeat(32);
    const student = 'cd'.repeat(32);
    const requests: string[] = [];
    const stored = new Map<string, string>();
    let recovery = author;
    Object.assign(unlocker, {
      request: async function* ({ identifier, purpose }: any) {
        requests.push(purpose);
        if (purpose === 'unlock') {
          const key = stored.get(identifier?.rubric);
          yield { key: 'ef'.repeat(32), passphrase: null };
          if (key) yield { key, passphrase: null };
          return;
        }
        if (purpose === 'submit' || purpose === 'revise') {
          if (identifier?.assignee !== 'student@example.com')
            throw new Error('Wrong assignee');
        }
        const key =
          purpose === 'create'
            ? author
            : purpose === 'recover'
              ? recovery
              : student;
        yield { key, passphrase: null };
      },
      store: async (id: string, key: string) => {
        stored.set(id, key);
      }
    });

    try {
      await app.commands.execute('correxit:convert');
      const created = Workbook.open(workbook);
      const saved = stored.get(created.id) === author;
      await Workbook.update(
        workbook,
        Rubric.add(
          created,
          {
            id: 'answer',
            is: 'comparable',
            points: 1,
            references: ['reference'],
            payload: null
          },
          [{ cell: 'answer', referent: 'reference', points: 1, secret: true }]
        )
      );
      await Workbook.assign(workbook, {
        roster: ['student@example.com']
      });
      const stream = await app.commands.execute('correxit:propagate');
      let path = '';
      let directory = '';
      for await (const [, emission] of stream) {
        if (emission.type === 'mkdir') directory = emission.slots[0];
        if (emission.type === 'saved') path = emission.slots[0];
      }
      const contents = app.serviceManager.contents;
      const issued = await contents.get(path, {
        type: 'notebook',
        content: true
      });
      Workbook.restore(workbook, issued.content);
      await app.commands.execute('correxit:unlock');
      const unlocked = !Workbook.open(workbook).locked;
      await Workbook.lock(workbook);

      await app.commands.execute('correxit:submit');
      const sealed = Workbook.open(workbook).assignment;
      const notebook = workbook.context.model.sharedModel;
      const encrypted = notebook.cells[0].getSource() !== 'student answer';
      const serialized = JSON.stringify(notebook.toJSON());
      const leaked =
        serialized.includes(author) || serialized.includes(student);

      // Reopen from persisted metadata so revision cannot rely on the rubric cache.
      Workbook.restore(workbook, workbook.context.model.toJSON());
      await app.commands.execute('correxit:revise');
      const revised = Workbook.open(workbook);
      const revision = {
        locked: revised.locked,
        key: revised.key,
        answer: notebook.cells[0].getSource(),
        reference: notebook.cells[1].getSource() !== 'secret reference',
        seal: revised.assignment.seal,
        submission: revised.assignment.submission,
        submitted: revised.assignment.submitted,
        private: revised.assignment.keys.private.assignee,
        public: revised.assignment.keys.public.assignee
      };

      // A new submission still permits the author to grade using only the author key.
      await app.commands.execute('correxit:submit');
      await app.commands.execute('correxit:unlock');
      const grading = {
        locked: Workbook.open(workbook).locked,
        answer: notebook.cells[0].getSource(),
        reference: notebook.cells[1].getSource()
      };

      // Exercise forensic recovery with broken metadata and a student credential.
      await Workbook.lock(workbook);
      await Workbook.update(workbook, Rubric.draft(Workbook.open(workbook)));
      await app.commands.execute('correxit:submit');
      const damaged = workbook.context.model.toJSON();
      (damaged.metadata.correxit as any).cxtformat = 999;
      Workbook.restore(workbook, damaged);
      recovery = student;
      await app.commands.execute('correxit:reset');
      return {
        issued: { directory, paths: [path] },
        saved,
        unlocked,
        encrypted,
        leaked,
        revision,
        grading,
        requests,
        sealed: !!sealed.seal && !!sealed.keys.private.assignee,
        recovered: notebook.cells[0].getSource(),
        reference: notebook.cells[1].getSource() !== 'secret reference',
        reset: !notebook.getMetadata('correxit')
      };
    } finally {
      Object.assign(unlocker, previous);
    }
  });

  expect(result.saved).toBe(true);
  expect(result.unlocked).toBe(true);
  expect(result.sealed).toBe(true);
  expect(result.encrypted).toBe(true);
  expect(result.leaked).toBe(false);
  expect(result.revision).toEqual({
    locked: true,
    key: null,
    answer: 'student answer',
    reference: true,
    seal: null,
    submission: null,
    submitted: null,
    private: null,
    public: null
  });
  expect(result.grading).toEqual({
    locked: false,
    answer: 'student answer',
    reference: 'secret reference'
  });
  expect(result.requests).toEqual([
    'create',
    'unlock',
    'submit',
    'revise',
    'submit',
    'unlock',
    'submit',
    'recover'
  ]);
  expect(result.recovered).toBe('student answer');
  expect(result.reference).toBe(true);
  expect(result.reset).toBe(true);
  await cleanup(page, result.issued);
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await dispose();
});

for (const stage of ['request', 'store']) {
  test(`conversion retains its proposed identity while awaiting ${stage}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
    const result = await page.evaluate(async stage => {
      const { Correxit, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const workbook = app.shell.currentWidget;
      const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
      const previous = { ...unlocker };
      const original = workbook.context.model.toJSON();
      original.nbformat_minor = 4;
      Workbook.restore(workbook, original);
      const snapshot = JSON.stringify(workbook.context.model.toJSON());
      const requested: any[] = [];
      const stored: any[] = [];
      const uncommitted: boolean[] = [];
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => {
        entered = resolve;
      });
      const custody = new Promise<void>(resolve => {
        release = resolve;
      });
      Object.assign(unlocker, {
        request: async function* (request: any) {
          requested.push(request);
          uncommitted.push(Workbook.open(workbook, true) === null);
          if (stage === 'request') {
            entered();
            await custody;
          }
          yield { key: 'ab'.repeat(32), passphrase: null };
        },
        store: async (id: string, key: string) => {
          stored.push({ id, key });
          uncommitted.push(Workbook.open(workbook, true) === null);
          if (stage === 'store') {
            entered();
            await custody;
          }
        }
      });
      try {
        const converting = app.commands.execute('correxit:convert');
        await waiting;
        const before = Workbook.open(workbook, true);
        const unchanged =
          snapshot === JSON.stringify(workbook.context.model.toJSON());
        const enabled = app.commands.isEnabled('correxit:convert');
        await app.commands.execute('correxit:convert');
        release();
        await converting;
        const rubric = Workbook.open(workbook);
        const persisted = workbook.context.model.toJSON().metadata.correxit;
        const { identifier, path, purpose } = requested[0];
        return {
          before: before === null,
          unchanged,
          enabled,
          uncommitted,
          requests: requested.length,
          stores: stored.length,
          purpose,
          identifier,
          path,
          id: rubric.id,
          same:
            identifier.rubric === stored[0].id && stored[0].id === persisted.id,
          key: rubric.key === stored[0].key,
          minor: workbook.context.model.nbformatMinor
        };
      } finally {
        release();
        Object.assign(unlocker, previous);
      }
    }, stage);
    expect(result).toMatchObject({
      before: true,
      unchanged: true,
      enabled: false,
      uncommitted: [true, true],
      requests: 1,
      stores: 1,
      purpose: 'create',
      same: true,
      key: true,
      minor: 5
    });
    expect(result.identifier).toEqual({
      assignee: null,
      assignment: null,
      file: result.path.split('/').pop(),
      issue: null,
      rubric: result.id
    });
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    await dispose();
  });
}

for (const stage of ['request', 'store']) {
  test(`conversion does not replace a workbook created while awaiting ${stage}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
    const result = await page.evaluate(async stage => {
      const { Correxit, Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const workbook = app.shell.currentWidget;
      const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
      const previous = { ...unlocker };
      const lock = Rubric.lock;
      const replacement = Rubric.create();
      let commit!: () => void;
      let ready!: () => void;
      const writing = new Promise<void>(resolve => {
        ready = resolve;
      });
      const persistence = new Promise<void>(resolve => {
        commit = resolve;
      });
      Rubric.lock = async (rubric: any) => {
        if (stage === 'store' && rubric.id === replacement.id) {
          ready();
          await persistence;
        }
        return lock(rubric);
      };
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => {
        entered = resolve;
      });
      const custody = new Promise<void>(resolve => {
        release = resolve;
      });
      const requested: string[] = [];
      const stored: string[] = [];
      Object.assign(unlocker, {
        request: async function* ({ identifier }: any) {
          requested.push(identifier.rubric);
          if (stage === 'request') {
            entered();
            await custody;
          }
          yield { key: 'ab'.repeat(32), passphrase: null };
        },
        store: async (id: string) => {
          stored.push(id);
          if (stage === 'store') {
            entered();
            await custody;
          }
        }
      });
      try {
        const converting = app.commands.execute('correxit:convert');
        await waiting;
        const replacing = Workbook.convert(
          workbook,
          'replacement',
          { request: async function* () {}, store: async () => {} },
          replacement
        );
        // Cover both a committed replacement and one still encrypting metadata.
        if (stage === 'store') await writing;
        else await replacing;
        const snapshot = JSON.stringify(workbook.context.model.toJSON());
        release();
        await converting;
        const result = {
          unchanged:
            snapshot === JSON.stringify(workbook.context.model.toJSON()),
          retained: Workbook.open(workbook).id === replacement.id,
          requested,
          stored,
          id: replacement.id
        };
        commit();
        await replacing;
        return result;
      } finally {
        release();
        commit();
        Rubric.lock = lock;
        Object.assign(unlocker, previous);
      }
    }, stage);
    expect(result.unchanged).toBe(true);
    expect(result.retained).toBe(true);
    expect(result.requested).toHaveLength(1);
    expect(result.requested[0]).not.toBe(result.id);
    expect(result.stored).toEqual(stage === 'store' ? result.requested : []);
    if (stage === 'store') {
      const dialog = page.locator('.jp-Dialog');
      await expect(dialog).toContainText('conversion superseded');
      await dialog.getByRole('button', { name: 'Close' }).click();
    }
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    await dispose();
  });
}

for (const outcome of ['cancel', 'decline', 'deny']) {
  test(`creation preserves the notebook on ${outcome} and retries with a fresh identity`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
    const result = await page.evaluate(async outcome => {
      const { Correxit, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const workbook = app.shell.currentWidget;
      const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
      const previous = { ...unlocker };
      const snapshot = JSON.stringify(workbook.context.model.toJSON());
      const requested: string[] = [];
      const stored: string[] = [];
      Object.assign(unlocker, {
        request: async function* ({ identifier, purpose }: any) {
          if (purpose === 'create') requested.push(identifier.rubric);
          if (purpose === 'create' && requested.length === 1) {
            if (outcome === 'deny') throw new Error('Access denied');
            if (outcome === 'decline') yield null;
            return;
          }
          yield { key: null, passphrase: 'author' };
        },
        store: async (id: string) => {
          stored.push(id);
        }
      });
      try {
        await app.commands.execute('correxit:convert');
        const unchanged =
          snapshot === JSON.stringify(workbook.context.model.toJSON());
        const empty =
          Workbook.open(workbook, true) === null && stored.length === 0;
        await app.commands.execute('correxit:convert');
        const rubric = Workbook.open(workbook);
        await Workbook.lock(workbook);
        // Re-derive using the persisted ID, rather than a provider-supplied key.
        const unlocked = await app.commands.execute('correxit:unlock');
        return {
          unchanged,
          empty,
          requested,
          id: rubric.id,
          stored,
          unlocked: unlocked.id === rubric.id && !unlocked.locked
        };
      } finally {
        Object.assign(unlocker, previous);
      }
    }, outcome);
    expect(result.unchanged).toBe(true);
    expect(result.empty).toBe(true);
    expect(result.requested).toHaveLength(2);
    expect(result.requested[0]).not.toBe(result.requested[1]);
    expect(result.requested[1]).toBe(result.id);
    expect(result.stored).toEqual([result.id, result.id]);
    expect(result.unlocked).toBe(true);
    if (outcome === 'deny') {
      const dialog = page.locator('.jp-Dialog');
      await expect(dialog).toContainText('Access denied');
      await dialog.getByRole('button', { name: 'Close' }).click();
    }
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    await dispose();
  });
}

for (const outcome of ['cancel', 'decline', 'deny']) {
  test(`submission respects an unlocker decision to ${outcome}`, async ({
    page
  }) => {
    const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
    const result = await page.evaluate(async outcome => {
      const { Correxit, Rubric, Workbook } = (window as any).__correxit__;
      const app = (window as any).jupyterapp;
      const workbook = app.shell.currentWidget;
      const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
      const previous = { ...unlocker };
      const created = await Workbook.convert(
        workbook,
        { key: 'ab'.repeat(32), passphrase: null },
        unlocker
      );
      await Workbook.update(
        workbook,
        Rubric.add(created, {
          id: 'answer',
          is: 'reviewable',
          points: 1,
          references: null,
          payload: null
        })
      );
      await Workbook.assign(workbook, {
        assignee: 'student@example.com',
        roster: ['student@example.com']
      });
      await Workbook.lock(workbook);
      const snapshot = JSON.stringify(workbook.context.model.toJSON());
      unlocker.request = async function* () {
        if (outcome === 'deny') throw new Error('Access denied');
        if (outcome === 'cancel') return;
        yield null;
      };
      try {
        await app.commands.execute('correxit:submit');
        const rubric = Workbook.open(workbook);
        return {
          unchanged:
            snapshot === JSON.stringify(workbook.context.model.toJSON()),
          sealed: !!rubric.assignment.seal,
          student: rubric.assignment.keys.private.assignee,
          locked: rubric.locked
        };
      } finally {
        Object.assign(unlocker, previous);
      }
    }, outcome);
    expect(result.unchanged).toBe(outcome !== 'decline');
    expect(result.sealed).toBe(outcome === 'decline');
    expect(result.student).toBeNull();
    expect(result.locked).toBe(true);
    if (outcome === 'deny') {
      await expect(page.locator('.jp-Dialog')).toContainText('Access denied');
      await page
        .locator('.jp-Dialog')
        .getByRole('button', { name: 'Close' })
        .click();
    }
    await dispose();
  });
}

test('failed key custody preserves edits made while conversion is pending', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  const result = await page.evaluate(async () => {
    const { Correxit, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
    const previous = { ...unlocker };
    let snapshot: string | null = null;
    Object.assign(unlocker, {
      request: async function* () {
        yield { key: 'ab'.repeat(32), passphrase: null };
      },
      store: async () => {
        workbook.context.model.sharedModel.cells[0].setSource(
          'concurrent edit'
        );
        snapshot = JSON.stringify(workbook.context.model.toJSON());
        throw new Error('Custody unavailable');
      }
    });
    try {
      await app.commands.execute('correxit:convert');
      return {
        unchanged: snapshot === JSON.stringify(workbook.context.model.toJSON()),
        rubric: Workbook.open(workbook, true)
      };
    } finally {
      Object.assign(unlocker, previous);
    }
  });
  expect(result).toEqual({ unchanged: true, rubric: null });
  await expect(page.locator('.jp-Dialog')).toContainText('Custody unavailable');
  await page
    .locator('.jp-Dialog')
    .getByRole('button', { name: 'Close' })
    .click();
  await dispose();
});

test('the default unlocker derives separate author and student credentials', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  const result = await page.evaluate(async () => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    await app.commands.execute('correxit:convert', { passphrase: 'author' });
    const created = Workbook.open(workbook);
    await Workbook.update(
      workbook,
      Rubric.add(
        {
          ...created,
          contents: [{ id: 'answer', type: 'code', digest: null }]
        },
        {
          id: 'answer',
          is: 'reviewable',
          points: 1,
          references: null,
          payload: null
        }
      )
    );
    await Workbook.assign(workbook, {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });
    await Workbook.lock(workbook);
    await app.commands.execute('correxit:submit', { passphrase: 'student' });
    await app.commands.execute('correxit:revise', { passphrase: 'student' });
    const revised = Workbook.open(workbook);
    const locked = revised.locked;
    await app.commands.execute('correxit:unlock');
    return {
      locked,
      answer: workbook.context.model.sharedModel.cells[0].getSource(),
      key: Workbook.open(workbook).key === created.key
    };
  });
  expect(result).toEqual({ locked: true, answer: 'answer', key: true });
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await dispose();
});

test('student credentials never enter author unlocking when commands use a path', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  const result = await page.evaluate(async () => {
    const { Correxit, Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
    const previous = unlocker.request;
    let calls = 0;
    unlocker.request = async function* (req: any) {
      if (req.purpose === 'unlock') {
        ++calls;
        throw new Error('Author access requested');
      }
    };
    try {
      await app.commands.execute('correxit:convert', { key: 'ab'.repeat(32) });
      await Workbook.update(
        workbook,
        Rubric.add(Workbook.open(workbook), {
          id: 'answer',
          is: 'reviewable',
          points: 1,
          references: null,
          payload: null
        })
      );
      await Workbook.assign(workbook, {
        assignee: 'student@example.com',
        roster: ['student@example.com']
      });
      await Workbook.lock(workbook);
      await workbook.context.save();
      const path = workbook.context.path;
      const key = 'cd'.repeat(32);
      await app.commands.execute('correxit:submit', { path, key });
      const submitted = (await app.serviceManager.contents.get(path)).content;
      await app.commands.execute('correxit:revise', { path, key });
      const revised = (await app.serviceManager.contents.get(path)).content;
      return {
        calls,
        sealed: !!submitted.metadata.correxit.assignment.seal,
        encrypted: submitted.cells[0].source !== 'answer',
        answer: revised.cells[0].source,
        locked: revised.metadata.correxit.locked,
        seal: revised.metadata.correxit.assignment.seal
      };
    } finally {
      unlocker.request = previous;
    }
  });
  expect(result).toEqual({
    calls: 0,
    sealed: true,
    encrypted: true,
    answer: 'answer',
    locked: true,
    seal: null
  });
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await dispose();
});

test('the default unlock prompt reports rejection, permits cancellation, and retries', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  try {
    await page.evaluate(async () => {
      const { Workbook } = (window as any).__correxit__;
      const workbook = (window as any).jupyterapp.shell.currentWidget;
      // Leave the default provider's credential cache empty.
      await Workbook.convert(workbook, 'correct-passphrase', {
        store: async () => {},
        request: async function* () {}
      });
      await Workbook.lock(workbook);
    });
    const unlock = () =>
      page.evaluate(() => {
        window.setTimeout(() => {
          (window as any).__unlock = (
            window as any
          ).jupyterapp.commands.execute('correxit:unlock');
        }, 0);
      });
    const dialog = page.locator('.jp-Dialog');
    await unlock();
    await expect(dialog).toContainText('Enter passphrase to unlock');
    await dialog.getByRole('textbox').fill('incorrect');
    await dialog.getByRole('button', { name: /^ok$/i }).click();
    await expect(dialog).toContainText('Could not unlock');
    await expect(dialog).toContainText('Incorrect passphrase');
    expect(
      await page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        return Workbook.open((window as any).jupyterapp.shell.currentWidget)
          .locked;
      })
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).click();

    await unlock();
    await expect(dialog).toContainText('Enter passphrase to unlock');
    await dialog.getByRole('button', { name: /^cancel$/i }).click();
    expect(await page.evaluate(() => (window as any).__unlock)).toBeNull();
    await expect(dialog).toHaveCount(0);

    await unlock();
    await expect(dialog).toContainText('Enter passphrase to unlock');
    await dialog.getByRole('textbox').fill('correct-passphrase');
    await dialog.getByRole('button', { name: /^ok$/i }).click();
    expect(
      await page.evaluate(async () => {
        const rubric = await (window as any).__unlock;
        return rubric.locked;
      })
    ).toBe(false);
    await expect(dialog).toHaveCount(0);
  } finally {
    await dispose();
  }
});

test('the default submission and revision prompts still work', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  await page.evaluate(async () => {
    const { Rubric, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    await app.commands.execute('correxit:convert', { key: 'ab'.repeat(32) });
    await Workbook.update(
      workbook,
      Rubric.add(Workbook.open(workbook), {
        id: 'answer',
        is: 'reviewable',
        points: 1,
        references: null,
        payload: null
      })
    );
    await Workbook.assign(workbook, {
      assignee: 'student@example.com',
      roster: ['student@example.com']
    });
    await Workbook.lock(workbook);
    window.setTimeout(() => {
      void app.commands.execute('correxit:submit');
    }, 0);
  });
  const dialog = page.locator('.jp-Dialog');
  await dialog
    .getByRole('button', { name: 'Set passphrase', exact: true })
    .click();
  await dialog.getByRole('textbox').fill('student');
  await dialog.getByRole('button', { name: /^ok$/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        return !!Workbook.open((window as any).jupyterapp.shell.currentWidget)
          .assignment.submitted;
      })
    )
    .toBe(true);
  await page.evaluate(() => {
    window.setTimeout(() => {
      void (window as any).jupyterapp.commands.execute('correxit:revise');
    }, 0);
  });
  await dialog.getByRole('textbox').fill('student');
  await dialog.getByRole('button', { name: /^ok$/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { Workbook } = (window as any).__correxit__;
        const workbook = (window as any).jupyterapp.shell.currentWidget;
        const rubric = Workbook.open(workbook);
        return {
          locked: rubric.locked,
          seal: rubric.assignment.seal,
          answer: workbook.context.model.sharedModel.cells[0].getSource()
        };
      })
    )
    .toEqual({ locked: true, seal: null, answer: 'answer' });
  await dispose();
});
