let count = 0;
const randomUUID = () => {
  count += 1;
  return `00000000-0000-0000-0000-${count.toString(16).padStart(12, '0')}`;
};
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    writable: true
  });
} else if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = randomUUID;
}
if (typeof globalThis.DragEvent === 'undefined') {
  globalThis.DragEvent = class DragEvent {};
}
