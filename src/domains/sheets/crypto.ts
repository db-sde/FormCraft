/** Moved to @/lib/crypto/encryption (shared by every stored secret). */
export {
  decryptJson,
  encryptJson,
  needsReencryption,
  type EncryptedPayload,
} from "@/lib/crypto/encryption";
