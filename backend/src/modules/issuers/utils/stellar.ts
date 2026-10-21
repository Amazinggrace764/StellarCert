import { StrKey } from '@stellar/stellar-sdk';

export function isValidStellarPublicKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) {
    return false;
  }
  try {
    // decodeEd25519PublicKey throws for invalid keys and is the
    // supported replacement for the deprecated isValidEd25519PublicKey.
    StrKey.decodeEd25519PublicKey(key);
    return true;
  } catch {
    return false;
  }
}
