import * as pgp from 'openpgp';

export type PrivateKey = pgp.PrivateKey;

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
  return pgp.encrypt({ message, passwords: [password] }) as Promise<string>;
}

export async function hmac(message: string, key: string): Promise<string> {
  const decode = (hex: string): ArrayBuffer => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes.buffer;
  };
  const material = await crypto.subtle.importKey(
    'raw',
    decode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    material,
    new TextEncoder().encode(message)
  );
  const hexadecimal = (byte: number) => byte.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(signed)).map(hexadecimal).join('');
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
  const hexadecimal = (byte: number) => byte.toString(16).padStart(2, '0');
  return Array.from(new Uint8Array(bits)).map(hexadecimal).join('');
}

/** Generate an ECC Curve25519 keypair. The private key is unprotected. */
export async function keypair(): Promise<{
  public: string;
  private: string;
}> {
  const { publicKey, privateKey } = await pgp.generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'correxit' }],
    format: 'armored'
  });
  return { public: publicKey, private: privateKey };
}

/** Parse an armored PGP private key for reuse across multiple unseal calls. */
export async function parse(armored: string): Promise<PrivateKey> {
  return pgp.readPrivateKey({ armoredKey: armored });
}

/** Encrypt text to one or more PGP public keys. */
export async function seal(
  text: string,
  recipients: string[]
): Promise<string> {
  const message = await pgp.createMessage({ text });
  const keys = recipients.map(armored => pgp.readKey({ armoredKey: armored }));
  return pgp.encrypt({ message, encryptionKeys: await Promise.all(keys) });
}

/** Decrypt PGP ciphertext using a parsed or armored private key. */
export async function unseal(
  text: string,
  recipient: string | PrivateKey
): Promise<string> {
  const key = typeof recipient === 'string'
    ? await parse(recipient) : recipient;
  const message = await pgp.readMessage({ armoredMessage: text });
  return (await pgp.decrypt({ message, decryptionKeys: key }))
    .data as string;
}
