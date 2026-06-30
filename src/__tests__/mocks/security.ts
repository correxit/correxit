export const encrypt = jest.fn(
  async (text: string, key: string) => `ENC[${key}]:${text}`
);

export const encrypted = jest.fn((text: string) => text.startsWith('ENC['));

export const decrypt = jest.fn(async (text: string, key: string) => {
  const prefix = `ENC[${key}]:`;
  if (!text.startsWith(prefix)) {
    throw new Error(`Mock Decrypt Failed: Key mismatch. Text: ${text}`);
  }
  return text.slice(prefix.length);
});

export const digest = jest.fn(async (text: string) => `DIGEST<${text}>`);

export const hmac = jest.fn(
  async (message: string, key: string) => `HMAC<${message}:${key}>`
);

export const keygen = jest.fn(
  async (passphrase: string, salt: string) =>
    `KEY<${passphrase}:${salt || 'default'}>`
);

export const keypair = jest.fn(async () => ({
  public: 'PGP_PUBLIC_KEY',
  private: 'PGP_PRIVATE_KEY'
}));

export const parse = jest.fn(async (armored: string) => armored);

export const seal = jest.fn(
  async (text: string, recipients: string[]) =>
    `SEALED[${recipients.join(',')}]:${text}`
);

export const sign = jest.fn(
  async (text: string, key: string | unknown) =>
    `SIGNED[${String(key)}]:${text}`
);

export const unseal = jest.fn(async (text: string, _key: string | unknown) => {
  const match = text.match(/^SEALED\[.*?\]:(.*)$/);
  if (!match) throw new Error('Mock unseal failed');
  return match[1];
});

export const verify = jest.fn(async (text: string) => {
  const match = text.match(/^SIGNED\[.*?\]:(.*)$/);
  if (!match) throw new Error('Mock verify failed');
  return match[1];
});
