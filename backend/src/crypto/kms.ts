// KMS stub — returns the KEK from env/config.
// Swap this interface for AWS KMS, GCP KMS, or Vault transit later without touching envelope.ts.

export interface KmsProvider {
  getKek(keyVersion: string): Buffer
}

// v1: single KEK from env, keyVersion ignored (only one version supported until rotation tooling ships in P9)
export function createEnvKmsProvider(kek: Buffer): KmsProvider {
  return {
    getKek(_keyVersion: string): Buffer {
      return kek
    },
  }
}
