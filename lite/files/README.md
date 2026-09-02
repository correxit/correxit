# Welcome to Correxit

This demo is a complete Correxit assignment running entirely in your browser.
There is no server behind it, and your changes stay on this device.

## The example

`chinook.ipynb` is a ready-made SQL workbook built around the
[Chinook sample database](https://www.sqlitetutorial.net/sqlite-sample-database/).
It contains three questions whose results are compared with encrypted reference
answers.

- `chinook.ipynb` — this workbook
- `chinook.db` — the SQLite database loaded by the first code cell
- **Author passphrase:** `xsql`

## Try Correxit

1. In the Correxit panel, unlock the workbook with the passphrase `xsql`.
2. Select an answer cell to inspect its points and reference answer.
3. Choose **Correct workbook…** to run and score the whole assignment.
4. Change an answer, correct it again, and watch the score respond.
5. Lock the workbook to encrypt its secret references again.

Correxit is kernel-agnostic: this example uses SQLite, but the same workflow
works with notebooks written for Python, R, Julia, and other Jupyter kernels.

## Other files

`assign-one.mjs` demonstrates Correxit's optional Node entrypoint; it is not
used by this browser demo. The `nbgrader` folder contains notebooks for trying
Correxit's nbgrader importer.

The demo opens in Jupyter Notebook so the assignment stays front and center.
[JupyterLab](../lab/) remains available for development and exploration.
