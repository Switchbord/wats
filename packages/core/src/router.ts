import type { ParsedUpdateEvent } from "./updateParser.js";

/**
 * @deprecated WATS-176: the untyped `{field, subtype}` router is
 * superseded by the typed {@link TypedRouter} (see `typedRouter.ts`,
 * re-exported as `TypedRouter` / `createTypedRouter`). The typed
 * system dispatches over `TypedUpdate` with branded `TypedFilter`s
 * instead of string discriminators. Scheduled for removal from the
 * barrel in the next minor release.
 * @see TypedRouter
 * @see DispatchReport
 */
export type UpdateRouteSelector = {
  field: string;
  subtype?: string;
};

/**
 * @deprecated WATS-176: use the typed `Handler` from `typedRouter.ts`
 * (dispatched over `TypedUpdate`). Scheduled for barrel removal next minor.
 * @see TypedRouter
 */
export type UpdateRouteHandler = (event: ParsedUpdateEvent) => void | Promise<void>;

/**
 * @deprecated WATS-176: legacy router error record. The typed
 * equivalent is the `DispatchReport.errors` entry shape from
 * `typedRouter.ts`. Scheduled for barrel removal next minor.
 * @see DispatchReport
 */
export interface DispatchErrorRecord {
  field: string;
  subtype?: string;
  eventType: string;
  eventIndex: number;
  handlerIndex: number;
  error: unknown;
}

/**
 * @deprecated WATS-176: legacy dispatch limit error code. The typed
 * `TypedRouter` surfaces caps via `DispatchReport.capped`. Scheduled for
 * barrel removal next minor.
 * @see DispatchReport
 */
export type DispatchLimitErrorCode = "handlers_per_event_limit_exceeded" | "dispatches_limit_exceeded";

/**
 * @deprecated WATS-176: legacy dispatch limit error. The typed
 * equivalent is the cap reporting on `DispatchReport` from
 * `typedRouter.ts`. Scheduled for barrel removal next minor.
 * @see DispatchReport
 */
export interface DispatchLimitError {
  code: DispatchLimitErrorCode;
  message: string;
  eventIndex: number;
}

/**
 * @deprecated WATS-176: legacy dispatch summary. Use `DispatchReport`
 * from the typed `TypedRouter` (`typedRouter.ts`) instead. Scheduled
 * for barrel removal next minor.
 * @see DispatchReport
 */
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

/**
 * @deprecated WATS-176: legacy router options. The typed equivalent is
 * `TypedRouterOptions` from `typedRouter.ts`. Scheduled for barrel
 * removal next minor.
 * @see TypedRouterOptions
 */
export interface UpdateRouterOptions {
  maxHandlersPerEvent?: number;
  maxDispatches?: number;
}

interface RegisteredRoute {
  selector: UpdateRouteSelector;
  handler: UpdateRouteHandler;
  handlerIndex: number;
}

/**
 * @deprecated WATS-176: legacy router defaults. The typed `TypedRouter`
 * exposes its own defaults via `TypedRouterOptions` (`typedRouter.ts`).
 * Scheduled for barrel removal next minor.
 * @see TypedRouterOptions
 */
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

/**
 * @deprecated WATS-176: the untyped `UpdateRouter` is superseded by
 * `TypedRouter` (`typedRouter.ts`), which dispatches over `TypedUpdate`
 * with branded `TypedFilter`s. Scheduled for barrel removal next minor.
 * @see TypedRouter
 */
export interface UpdateRouter {
  on(selector: UpdateRouteSelector, handler: UpdateRouteHandler): void;
  dispatch(events: readonly ParsedUpdateEvent[]): Promise<DispatchSummary>;
}

/**
 * @deprecated WATS-176: construct a `TypedRouter` instead (see
 * `typedRouter.ts`, re-exported as `TypedRouter` / `createTypedRouter`).
 * The typed router dispatches over `TypedUpdate` with branded
 * `TypedFilter`s and surfaces `DispatchReport`. Scheduled for barrel
 * removal next minor.
 * @see TypedRouter
 * @see DispatchReport
 */
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

/**
 * @deprecated WATS-176: legacy parsed-event shape. Use `TypedUpdate`
 * from `webhookNormalizer.ts` instead (produced by
 * `normalizeWebhookEnvelope`). Scheduled for barrel removal next minor.
 * @see TypedUpdate
 * @see normalizeWebhookEnvelope
 */
export type { ParsedUpdateEvent } from "./updateParser.js";
