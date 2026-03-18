import {
  createMessage,
  decrypt as DECRYPT,
  encrypt as ENCRYPT,
  readMessage
} from 'openpgp';

export async function decrypt(text: string, password: string): Promise<string> {
  let message;
  try {
    message = await readMessage({ armoredMessage: text });
  } catch (_) {
    return text;
  }
  return (await DECRYPT({ message, passwords: [password] })).data;
}

export async function digest(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const hexadecimal = (digit: number) => digit.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(hash)).map(hexadecimal).join('');
}

export async function encrypt(text: string, password: string): Promise<string> {
  const message = await createMessage({ text });
  return ENCRYPT({ message, passwords: [password] }) as Promise<string>;
}

export async function keygen(
  passphrase: string,
  salt: string
): Promise<string> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 600_000,
      hash: 'SHA-256'
    },
    material,
    256
  );
  const hexadecimal = (digit: number) => digit.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(bits)).map(hexadecimal).join('');
}
