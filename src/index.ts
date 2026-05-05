import { Correxit, Rubric, Workbook } from './correxit';
import * as kernels from './correxit/kernels';
export { plugins as default } from './plugins';
export { Correxit, Rubric, Workbook };

if (typeof window !== 'undefined' && !!(window as any).galata) {
  Object.defineProperty(window as any, '__correxit__', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      Correxit,
      Rubric,
      Workbook,
      kernels: Object.freeze({ drain: kernels.drain })
    }),
    writable: false
  });
}
