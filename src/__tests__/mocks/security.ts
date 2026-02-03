export const encrypt = jest.fn(
  async (text: string, key: string) => `ENC[${key}]:${text}`
);

export const decrypt = jest.fn(async (text: string, key: string) => {
  const prefix = `ENC[${key}]:`;
  if (!text.startsWith(prefix)) {
    throw new Error(`Mock Decrypt Failed: Key mismatch. Text: ${text}`);
  }
  return text.slice(prefix.length);
});

export const digest = jest.fn(async (text: string) => `DIGEST<${text}>`);

export const keygen = jest.fn(
  async (passphrase: string, salt: string) =>
    `KEY<${passphrase}:${salt || 'default'}>`
);
