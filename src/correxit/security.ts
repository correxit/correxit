import * as pgp from 'openpgp';

// Equivalent to: await digest('correxit:salt');
const SALT =
  'af4680e881d3da6272c9026660c11e8cbf89ecf515a3c6489e9330b1bed47cf8';
// Equivalent to: await digest('correxit:pepper');
const PEPPER =
  'a4964c9269aeecfbdd4143cfd087c2262351f0d6bf1961bc56cd0e247c1c71e9';

export async function decrypt(text: string, password: string): Promise<string> {
  let message;
  try {
    message = await pgp.readMessage({ armoredMessage: text });
  } catch (_) {
    return text;
  }
  return (await pgp.decrypt({ message, passwords: [password] })).data;
}

export async function digest(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const hexadecimal = (digit: number) => digit.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(hash)).map(hexadecimal).join('');
}

export async function encrypt(text: string, password: string): Promise<string> {
  const message = await pgp.createMessage({ text });
  return pgp.encrypt({ message, passwords: [password] });
}

export async function keygen(
  passphrase: string,
  salt = SALT,
  pepper = PEPPER
): Promise<string> {
  return digest(`${salt}:${await digest(passphrase)}:${pepper}`);
}
