import { consumer, corrector, source, ui, unlocker } from './plugins';
import { Correxit, Rubric, Workbook } from './correxit';
export { Correxit, Rubric, Workbook };
export default [consumer, corrector, source, ui, unlocker];

if (typeof window !== 'undefined' && !!(window as any).galata) {
  Object.defineProperty(window as any, '__correxit__', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ Correxit, Rubric, Workbook }),
    writable: false
  });
}
