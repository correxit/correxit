import { expect, test } from './fixtures';
import { setup } from './utils';

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
      request: async (workbook: any, purpose: string) => {
        requests.push(purpose);
        if (purpose === 'submit' || purpose === 'revise') {
          const identifier = Workbook.identifier(workbook);
          if (identifier.assignee !== 'student@example.com')
            throw new Error('Wrong assignee');
        }
        const key =
          purpose === 'create'
            ? author
            : purpose === 'recover'
              ? recovery
              : student;
        return { secret: { key, passphrase: null } };
      },
      store: async (id: string, key: string) => {
        stored.set(id, key);
      },
      unlock: async (workbook: any) => {
        requests.push('unlock');
        return Workbook.unlock(
          workbook,
          stored.get(Workbook.identifier(workbook).rubric)
        );
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
        assignee: 'student@example.com',
        roster: ['student@example.com']
      });
      await Workbook.lock(workbook);
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
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await dispose();
});

test('conversion waits for key custody before committing metadata', async ({
  page
}) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  const result = await page.evaluate(async () => {
    const { Correxit, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
    const previous = { ...unlocker };
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      entered = resolve;
    });
    const custody = new Promise<void>(resolve => {
      release = resolve;
    });
    Object.assign(unlocker, {
      request: async () => ({
        secret: { key: 'ab'.repeat(32), passphrase: null }
      }),
      store: async () => {
        entered();
        await custody;
      }
    });
    try {
      const converting = app.commands.execute('correxit:convert');
      await waiting;
      const before = Workbook.open(workbook, true);
      release();
      await converting;
      return {
        before: before === null,
        after: !!Workbook.open(workbook, true)
      };
    } finally {
      release();
      Object.assign(unlocker, previous);
    }
  });
  expect(result).toEqual({ before: true, after: true });
  await dispose();
});

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
      unlocker.request = async () => {
        if (outcome === 'deny') throw new Error('Access denied');
        return outcome === 'cancel' ? null : { secret: null };
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

test('failed key custody restores the original notebook', async ({ page }) => {
  const { dispose } = await setup(page, [{ id: 'answer', source: 'answer' }]);
  const result = await page.evaluate(async () => {
    const { Correxit, Workbook } = (window as any).__correxit__;
    const app = (window as any).jupyterapp;
    const workbook = app.shell.currentWidget;
    const unlocker = await app.resolveRequiredService(Correxit.Unlocker);
    const previous = { ...unlocker };
    const snapshot = JSON.stringify(workbook.context.model.toJSON());
    Object.assign(unlocker, {
      request: async () => ({
        secret: { key: 'ab'.repeat(32), passphrase: null }
      }),
      store: async () => {
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
    const previous = unlocker.unlock;
    let calls = 0;
    unlocker.unlock = async () => {
      ++calls;
      throw new Error('Author access requested');
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
      unlocker.unlock = previous;
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
