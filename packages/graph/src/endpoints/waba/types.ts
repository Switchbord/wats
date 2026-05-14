// WATS-67 WABA endpoint shared types.

export interface GraphPaging {
  readonly cursors?: {
    readonly before?: string;
    readonly after?: string;
  };
  readonly next?: string;
  readonly previous?: string;
}
