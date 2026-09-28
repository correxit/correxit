/**
 * Public browser and JupyterLab API.
 *
 * The core models are discriminated unions: {@link Rubric} by `locked` and
 * {@link Workbook} by `content`.
 *
 * @module Browser
 */
import { Assignment, Correxit, Rubric, Workbook } from './correxit';
export type { Secret } from './correxit/security';
export { plugins as default } from './plugins';
export { Assignment, Correxit, Rubric, Workbook };
