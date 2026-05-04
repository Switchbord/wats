import type { MessageContext } from "./media";

export interface LocationPayload {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface LocationMessage {
  type: "location";
  id: string;
  from: string;
  timestamp: string;
  location: LocationPayload;
  context?: MessageContext;
  raw?: unknown;
}
