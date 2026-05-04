export interface WhatsAppClientConfig {
  token: string;
  phoneNumberId: string;
  appSecret?: string;
  verifyToken?: string;
  apiVersion?: string;
  baseUrl?: string;
}

export interface WhatsAppClientRuntimeConfig
  extends Required<Pick<WhatsAppClientConfig, "token" | "phoneNumberId">> {
  appSecret?: string;
  verifyToken?: string;
  apiVersion: string;
  baseUrl: string;
}

export const WATS_TYPES_CONFIG_EXPORTS = [
  "WhatsAppClientConfig",
  "WhatsAppClientRuntimeConfig"
] as const;
