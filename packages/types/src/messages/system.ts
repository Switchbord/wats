export interface SystemNotification {
  body: string;
  type?: string;
  identity?: string;
  wa_id?: string;
  customer?: string;
  newWaId?: string;
}

export interface SystemMessage {
  type: "system";
  id: string;
  from: string;
  timestamp: string;
  system: SystemNotification;
  raw?: unknown;
}
