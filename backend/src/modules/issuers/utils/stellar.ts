import { StrKey } from '@stellar/stellar-sdk';

export function isValidStellarPublicKey(key: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(key);
  } catch {
    return false;
  }
}
