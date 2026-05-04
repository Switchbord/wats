import type { ParsedUpdateEvent } from "../updateParser";

export type UpdateFilter = (event: ParsedUpdateEvent) => boolean;

function isFilterPass(result: unknown): result is true {
  return result === true;
}

export function and(...filters: readonly UpdateFilter[]): UpdateFilter {
  return (event) => {
    for (const filter of filters) {
      if (!isFilterPass(filter(event))) {
        return false;
      }
    }

    return true;
  };
}

export function or(...filters: readonly UpdateFilter[]): UpdateFilter {
  return (event) => {
    for (const filter of filters) {
      if (isFilterPass(filter(event))) {
        return true;
      }
    }

    return false;
  };
}

export function not(filter: UpdateFilter): UpdateFilter {
  return (event) => !isFilterPass(filter(event));
}
