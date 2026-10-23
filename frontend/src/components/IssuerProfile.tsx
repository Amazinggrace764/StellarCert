import { useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';

interface IssuerProfileFormData {
  stellarPublicKey: string;
  stellarSecretKey: string;
}

export default function IssuerProfile() {
  const [formData, setFormData] = useState<IssuerProfileFormData>({
    stellarPublicKey: '',
    stellarSecretKey: '',
  });

  const generateKeypair = () => {
    const pair = Keypair.random();
    setFormData((prev) => ({
      ...prev,
      stellarPublicKey: pair.publicKey(),
      stellarSecretKey: pair.secret(),
    }));
  };

  return (
    <div>
      <label>
        Stellar Public Key
        <input readOnly value={formData.stellarPublicKey} aria-label="Stellar Public Key" />
      </label>
      <label>
        Stellar Secret Key
        <input readOnly value={formData.stellarSecretKey} aria-label="Stellar Secret Key" />
      </label>
      <button type="button" onClick={generateKeypair}>
        Generate Stellar Keypair
      </button>
    </div>
  );
}
