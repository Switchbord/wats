import type { ParsedUpdateEvent } from "./updateParser";

export type UpdateRouteSelector = {
  field: string;
  subtype?: string;
};

export type UpdateRouteHandler = (event: ParsedUpdateEvent) => void | Promise<void>;

export interface DispatchErrorRecord {
  field: string;
  subtype?: string;
  eventType: string;
  eventIndex: number;
  handlerIndex: number;
  error: unknown;
}

export type DispatchLimitErrorCode = "handlers_per_event_limit_exceeded" | "dispatches_limit_exceeded";

export interface DispatchLimitError {
  code: DispatchLimitErrorCode;
  message: string;
  eventIndex: number;
}

export interface DispatchSummary {
  totalEvents: number;
  matchedHandlers: number;
  executedHandlers: number;
  failedHandlers: number;
  unmatchedEvents: number;
  errors: DispatchErrorRecord[];
  capped: boolean;
  aborted: boolean;
  limitError?: DispatchLimitError;
}

export interface UpdateRouterOptions {
  maxHandlersPerEvent?: number;
  maxDispatches?: number;
}

interface RegisteredRoute {
  selector: UpdateRouteSelector;
  handler: UpdateRouteHandler;
  handlerIndex: number;
}

export const DEFAULT_UPDATE_ROUTER_LIMITS = {
  maxHandlersPerEvent: 64,
  maxDispatches: 10_000
} as const;

const EMPTY_ROUTES: readonly RegisteredRoute[] = [];

function toPositiveLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function createRouteKey(field: string, subtype: string): string {
  return `${field}:${subtype}`;
}

export interface UpdateRouter {
  on(selector: UpdateRouteSelector, handler: UpdateRouteHandler): void;
  dispatch(events: readonly ParsedUpdateEvent[]): Promise<DispatchSummary>;
}

export function createUpdateRouter(options: UpdateRouterOptions = {}): UpdateRouter {
  const routesByField = new Map<string, RegisteredRoute[]>();
  const routesByFieldSubtype = new Map<string, RegisteredRoute[]>();
  let nextHandlerIndex = 0;

  const limits = {
    maxHandlersPerEvent: toPositiveLimit(options.maxHandlersPerEvent, DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent),
    maxDispatches: toPositiveLimit(options.maxDispatches, DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches)
  };

  return {
    on(selector, handler) {
      const route: RegisteredRoute = {
        selector,
        handler,
        handlerIndex: nextHandlerIndex
      };
      nextHandlerIndex += 1;

      if (selector.subtype === undefined) {
        const byField = routesByField.get(selector.field) ?? [];
        byField.push(route);
        routesByField.set(selector.field, byField);
        return;
      }

      const subtypeKey = createRouteKey(selector.field, selector.subtype);
      const bySubtype = routesByFieldSubtype.get(subtypeKey) ?? [];
      bySubtype.push(route);
      routesByFieldSubtype.set(subtypeKey, bySubtype);
    },

    async dispatch(events) {
      const summary: DispatchSummary = {
        totalEvents: events.length,
        matchedHandlers: 0,
        executedHandlers: 0,
        failedHandlers: 0,
        unmatchedEvents: 0,
        errors: [],
        capped: false,
        aborted: false
      };

      let totalDispatches = 0;

      for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
        const event = events[eventIndex];
        const fieldRoutes = routesByField.get(event.discriminator.field) ?? EMPTY_ROUTES;
        const subtypeRoutes = event.discriminator.subtype === undefined
          ? EMPTY_ROUTES
          : (routesByFieldSubtype.get(createRouteKey(event.discriminator.field, event.discriminator.subtype)) ?? EMPTY_ROUTES);

        const matchingRoutes = fieldRoutes.length + subtypeRoutes.length;

        if (matchingRoutes === 0) {
          summary.unmatchedEvents += 1;
          continue;
        }

        summary.matchedHandlers += matchingRoutes;

        let handlersToRun = matchingRoutes;
        if (matchingRoutes > limits.maxHandlersPerEvent) {
          handlersToRun = limits.maxHandlersPerEvent;
          summary.capped = true;
          summary.limitError = {
            code: "handlers_per_event_limit_exceeded",
            message: `Event ${eventIndex} matched ${matchingRoutes} handlers; capped at ${limits.maxHandlersPerEvent}.`,
            eventIndex
          };
        }

        let fieldIndex = 0;
        let subtypeIndex = 0;

        for (let dispatchIndex = 0; dispatchIndex < handlersToRun; dispatchIndex += 1) {
          const nextFieldRoute = fieldRoutes[fieldIndex];
          const nextSubtypeRoute = subtypeRoutes[subtypeIndex];

          let route: RegisteredRoute;
          if (nextSubtypeRoute === undefined || (nextFieldRoute !== undefined && nextFieldRoute.handlerIndex < nextSubtypeRoute.handlerIndex)) {
            route = nextFieldRoute as RegisteredRoute;
            fieldIndex += 1;
          } else {
            route = nextSubtypeRoute;
            subtypeIndex += 1;
          }

          if (totalDispatches >= limits.maxDispatches) {
            summary.capped = true;
            summary.aborted = true;
            summary.limitError = {
              code: "dispatches_limit_exceeded",
              message: `Total dispatches exceeded maxDispatches ${limits.maxDispatches}.`,
              eventIndex
            };
            return summary;
          }

          totalDispatches += 1;

          try {
            await route.handler(event);
            summary.executedHandlers += 1;
          } catch (error) {
            summary.failedHandlers += 1;
            summary.errors.push({
              field: event.discriminator.field,
              subtype: event.discriminator.subtype,
              eventType: event.discriminator.eventType,
              eventIndex,
              handlerIndex: route.handlerIndex,
              error
            });
          }
        }
      }

      return summary;
    }
  };
}

export type { ParsedUpdateEvent } from "./updateParser";
