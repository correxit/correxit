import * as pgp from 'openpgp';

const SALT = await digest('correxit:salt');
const PEPPER = await digest('correxit:pepper');

export async function decrypt(text: string, password: string) {
  let message;
  try {
    message = await pgp.readMessage({ armoredMessage: text });
  } catch (_) {
    return text;
  }
  return (await pgp.decrypt({ message, passwords: [password] })).data;
}

export async function digest(text: string) {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const hexadecimal = (digit: number) => digit.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(hash)).map(hexadecimal).join('');
}

export async function encrypt(text: string, password: string) {
  const message = await pgp.createMessage({ text });
  return pgp.encrypt({ message, passwords: [password] });
}

export async function keygen(passphrase: string, salt = SALT, pepper = PEPPER) {
  const hash = await digest(passphrase);
  return digest(`${salt}:${hash}:${pepper}`);
}
