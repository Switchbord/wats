import type { MessageContext } from "./media";

export interface OrderProductItem {
  productRetailerId: string;
  quantity?: number;
  itemPrice?: number;
  currency?: string;
}

export interface OrderPayload {
  catalogId: string;
  text?: string;
  productItems: OrderProductItem[];
}

export interface OrderMessage {
  type: "order";
  id: string;
  from: string;
  timestamp: string;
  order: OrderPayload;
  context?: MessageContext;
  raw?: unknown;
}
