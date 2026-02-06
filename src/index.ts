import { Correxit, Rubric, Workbook } from './correxit';
export { plugins as default } from './plugins';
export { Correxit, Rubric, Workbook };

if (typeof window !== 'undefined' && !!(window as any).galata) {
  Object.defineProperty(window as any, '__correxit__', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ Correxit, Rubric, Workbook }),
    writable: false
  });
}
