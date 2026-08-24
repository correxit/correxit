# Test Fixtures

Every file in this directory is third-party material used for testing.
Only BSD-compatible licenses are permitted.

## nbgrader/

Copied verbatim from [nbgrader](https://github.com/jupyter/nbgrader). We use
them to verify that our converter handles every upstream notebook format
correctly. Files come from three directories in the nbgrader repo, all under the
same license.

**License**: BSD 3-Clause (see [nbgrader LICENSE](https://github.com/jupyter/nbgrader/blob/main/LICENSE))

### From `nbgrader/tests/apps/files/` (35 notebooks, 1 image)

| File                                        | Description                                    |
| ------------------------------------------- | ---------------------------------------------- |
| `autotest-hashed-changed.ipynb`             | Hashed autotest, student answer changed        |
| `autotest-hashed-unchanged.ipynb`           | Hashed autotest, student answer unchanged      |
| `autotest-hashed.ipynb`                     | Source notebook with hashed autotests          |
| `autotest-hidden-changed-right.ipynb`       | Hidden autotest, correct student change        |
| `autotest-hidden-changed-wrong.ipynb`       | Hidden autotest, wrong student change          |
| `autotest-hidden-unchanged.ipynb`           | Hidden autotest, student answer unchanged      |
| `autotest-hidden.ipynb`                     | Source notebook with hidden autotests          |
| `autotest-multi-changed.ipynb`              | Multi-part autotest, student answer changed    |
| `autotest-multi-unchanged.ipynb`            | Multi-part autotest, student answer unchanged  |
| `autotest-multi.ipynb`                      | Source notebook with multi-part autotests      |
| `autotest-simple-changed.ipynb`             | Simple autotest, student answer changed        |
| `autotest-simple-unchanged.ipynb`           | Simple autotest, student answer unchanged      |
| `autotest-simple.ipynb`                     | Source notebook with simple autotests          |
| `infinite-loop-with-output.ipynb`           | Infinite loop cell that has prior output       |
| `infinite-loop.ipynb`                       | Infinite loop cell                             |
| `jupyter.png`                               | Image referenced by `open_relative_file.ipynb` |
| `open_relative_file.ipynb`                  | Notebook that opens a relative file path       |
| `side-effects.ipynb`                        | Notebook with side-effect-producing cells      |
| `submitted-changed.ipynb`                   | Submission with modified cells                 |
| `submitted-cheat-attempt-alternative.ipynb` | Cheat attempt (alternative method)             |
| `submitted-cheat-attempt.ipynb`             | Cheat attempt (modified test cell)             |
| `submitted-grade-cell-changed.ipynb`        | Submission where a grade cell was changed      |
| `submitted-locked-cell-changed.ipynb`       | Submission where a locked cell was changed     |
| `submitted-unchanged.ipynb`                 | Unmodified submission                          |
| `test.ipynb`                                | Basic test notebook (current schema)           |
| `test-hidden-tests.ipynb`                   | Notebook with hidden test cells                |
| `test-no-metadata-autotest.ipynb`           | Autotest notebook without nbgrader metadata    |
| `test-no-metadata.ipynb`                    | Notebook without nbgrader metadata             |
| `test-v0-invalid.ipynb`                     | Invalid v0 schema notebook                     |
| `test-v0.ipynb`                             | v0 schema notebook                             |
| `test-v1.ipynb`                             | v1 schema notebook                             |
| `test-v2.ipynb`                             | v2 schema notebook                             |
| `test-with-output.ipynb`                    | Test notebook with pre-existing output         |
| `timeout.ipynb`                             | Notebook with a cell that times out            |
| `too-new.ipynb`                             | Notebook with a future/unknown schema version  |
| `validating-environment-variable.ipynb`     | Notebook checking an environment variable      |
| `validation-zero-points.ipynb`              | Validation cell worth zero points              |

### From `nbgrader/tests/preprocessors/files/` (11 notebooks)

| File                              | Description                            |
| --------------------------------- | -------------------------------------- |
| `bad-markdown-cell-1.ipynb`       | Malformed markdown cell (variant 1)    |
| `bad-markdown-cell-2.ipynb`       | Malformed markdown cell (variant 2)    |
| `blank-grade-id.ipynb`            | Cell with an empty grade ID            |
| `blank-points.ipynb`              | Cell with blank points value           |
| `cell-type-changed.ipynb`         | Submission where cell type was altered |
| `duplicate-grade-ids.ipynb`       | Notebook with duplicate grade IDs      |
| `manually-graded-code-cell.ipynb` | Code cell requiring manual grading     |
| `no-cell-type.ipynb`              | Cell missing the type field            |
| `test_taskcell.ipynb`             | Notebook with task cells               |

### From `nbgrader/docs/source/user_guide/source/` (4 notebooks)

Renamed from the upstream directory structure (`ps1/problem1.ipynb`, etc.).

| File                          | Upstream path                        |
| ----------------------------- | ------------------------------------ |
| `ps1-problem1.ipynb`          | `source/ps1/problem1.ipynb`          |
| `ps1-problem2.ipynb`          | `source/ps1/problem2.ipynb`          |
| `ps1-autotest-problem1.ipynb` | `source/ps1_autotest/problem1.ipynb` |
| `ps1-autotest-problem2.ipynb` | `source/ps1_autotest/problem2.ipynb` |
