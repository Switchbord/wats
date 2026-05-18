import type { MessageContext } from "./media.js";

export interface InteractiveButtonReply {
  type: "button_reply";
  buttonReply: { id: string; title: string };
}

export interface InteractiveListReply {
  type: "list_reply";
  listReply: { id: string; title: string; description?: string };
}

export interface InteractiveNfmReply {
  type: "nfm_reply";
  nfmReply: { responseJson?: string; body?: string; name?: string };
}

export interface InteractiveProductReply {
  type: "product_reply";
  productReply: {
    catalogId: string;
    productRetailerId: string;
  };
}

export interface InteractiveProductListReply {
  type: "product_list_reply";
  productListReply: {
    catalogId: string;
    productItems: ReadonlyArray<{ productRetailerId: string }>;
  };
}

export interface InteractiveCtaUrlReply {
  type: "cta_url_reply";
  ctaUrlReply: { displayText: string; url: string };
}

export type InteractiveReply =
  | InteractiveButtonReply
  | InteractiveListReply
  | InteractiveNfmReply
  | InteractiveProductReply
  | InteractiveProductListReply
  | InteractiveCtaUrlReply;

export interface InteractiveMessage {
  type: "interactive";
  id: string;
  from: string;
  timestamp: string;
  interactive: InteractiveReply;
  context?: MessageContext;
  raw?: unknown;
}
