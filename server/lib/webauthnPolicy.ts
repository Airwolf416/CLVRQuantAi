import type { Request, Response } from "express";

export const LEGACY_WEBAUTHN_RESPONSE = {
  error: "Passkey credential must be re-enrolled",
  code: "WEBAUTHN_LEGACY_CREDENTIAL",
} as const;

export function rejectLegacyWebAuthnAuthentication(_req: Request, res: Response) {
  return res.status(401).json(LEGACY_WEBAUTHN_RESPONSE);
}