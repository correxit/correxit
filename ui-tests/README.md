# Integration Testing

This folder contains the integration tests of the extension.

They are defined using [Playwright](https://playwright.dev/docs/intro) test runner
and [Galata](https://github.com/jupyterlab/jupyterlab/tree/main/galata) helper.

The Playwright configuration is defined in [playwright.config.js](./playwright.config.js).

The JupyterLab server configuration to use for the integration test is defined
in [jupyter_server_test_config.py](./jupyter_server_test_config.py).

The default configuration will produce video for failing tests and an HTML report.

> There is a UI mode that you may like; see [that video](https://www.youtube.com/watch?v=jF0yA-JLQW0).

## Run the tests

> All commands are assumed to be executed from the root directory
> and run through the Pixi development environment.

To run the tests, you need to:

1. Compile the extension:

```sh
pixi run jlpm install
pixi run jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
pixi run jlpm install
pixi run jlpm playwright install
cd ..
```

3. Execute the [Playwright](https://playwright.dev/docs/intro) tests:

```sh
cd ./ui-tests
pixi run jlpm playwright test
```

Test results will be shown in the terminal. In case of any test failures, the test report
will be opened in your browser at the end of the tests execution; see
[Playwright documentation](https://playwright.dev/docs/test-reporters#html-reporter)
for configuring that behavior.

## Generate screenshots

If you want stable UI captures for a PR comment or documentation draft, run:

```sh
cd ./ui-tests
pixi run jlpm screenshots
```

The images are written to `ui-tests/screenshots/`. The dedicated screenshot
suite lives under `ui-tests/scenes/` and runs through
`playwright.screenshots.config.js`, so it is separate from the enforced
integration tests in `ui-tests/tests/`.
Each run also writes `ui-tests/screenshots/manifest.json` with the scene titles,
filenames, and captions so the assets are easier to reuse in PR comments or docs.

## Update the tests snapshots

> All commands are assumed to be executed from the root directory

If you are comparing snapshots to validate your tests, you may need to update
the reference snapshots stored in the repository. To do that, you need to:

1. Compile the extension:

```sh
pixi run jlpm install
pixi run jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
pixi run jlpm install
pixi run jlpm playwright install
cd ..
```

3. Execute the [Playwright](https://playwright.dev/docs/intro) command:

```sh
cd ./ui-tests
pixi run jlpm playwright test -u
```

Snapshot updates currently run locally. The former comment-triggered workflow
was removed before the repository became public because it combined
pull-request code with a repository write token. If CI and local rendering
differ, attach the relevant report to the pull request and have a maintainer
regenerate the snapshots in a clean checkout.

## Create tests

> All commands are assumed to be executed from the root directory

Most new UI coverage in this repository starts from an existing file:

- `ui-tests/tests/` for enforced integration tests
- `ui-tests/scenes/` for screenshot scenes

In practice, the lowest-friction workflow is usually:

1. Find the closest existing spec and copy its shape.
2. Reuse helpers from `ui-tests/tests/utils.ts` when possible.
3. Run only the one file you are editing while you iterate.
4. Use Playwright codegen only if you need help finding a selector or
   discovering the order of a UI interaction.

Codegen is a drafting tool, not the final style we keep in the repo. After using
it, move the useful parts into your spec and then simplify them to match the
rest of the codebase.

If you do want to use the Playwright code generator, the flow is:

1. Compile the extension:

```sh
pixi run jlpm install
pixi run jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
pixi run jlpm install
pixi run jlpm playwright install
cd ..
```

3. Start the server:

```sh
cd ./ui-tests
pixi run jlpm start
```

4. Execute the [Playwright code generator](https://playwright.dev/docs/codegen) in **another terminal**:

```sh
cd ./ui-tests
pixi run jlpm playwright codegen localhost:8888/lab
```

Then click through the workflow you care about in the browser window that
opens. Playwright will generate code for those interactions.

The useful pattern is:

- keep the locators or steps that helped you
- throw away the extra noise
- replace raw recorded clicks with existing helpers or command-driven setup
- finish by running the smallest relevant command:
  - `pixi run jlpm playwright test tests/my-spec.ts`
  - `pixi run jlpm screenshots`

## Debug tests

> All commands are assumed to be executed from the root directory

To debug tests, a good way is to use the inspector tool of playwright:

1. Compile the extension:

```sh
pixi run jlpm install
pixi run jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
pixi run jlpm install
pixi run jlpm playwright install
cd ..
```

3. Execute the Playwright tests in [debug mode](https://playwright.dev/docs/debug):

```sh
cd ./ui-tests
pixi run jlpm playwright test --debug
```

## Upgrade Playwright and the browsers

To update the web browser versions, you must update the package `@playwright/test`:

```sh
cd ./ui-tests
pixi run jlpm up "@playwright/test"
pixi run jlpm playwright install
```
