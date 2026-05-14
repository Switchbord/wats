// WATS-67 WABA phone-number listing endpoint.

import { defineEndpoint } from "../../endpoint";
import type { EndpointInvokeOptions } from "../../endpoint";
import { GraphRequestValidationError } from "../../errors";
import {
  normalizeListPhoneNumbersParams,
  sanitizeBusinessManagementOptions,
  type ListPhoneNumbersInput
} from "../businessManagement";
import type { GraphPaging } from "./types";

export interface PhoneNumberListEntry {
  readonly id: string;
  readonly display_phone_number?: string;
  readonly verified_name?: string;
  readonly quality_rating?: string;
}

export interface PhoneNumberListResponse {
  readonly data?: readonly PhoneNumberListEntry[];
  readonly paging?: GraphPaging;
}

const listPhoneNumbersRaw = defineEndpoint<
  { wabaId: string; fields?: string; limit?: string; after?: string; before?: string },
  never,
  PhoneNumberListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/phone_numbers",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" },
    before: { in: "query" }
  }
});

export const listPhoneNumbers = Object.assign(
  async function listPhoneNumbers(
    client: Parameters<typeof listPhoneNumbersRaw>[0],
    params: ListPhoneNumbersInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ) {
    if (body !== undefined) {
      throw new GraphRequestValidationError("Invalid listPhoneNumbers input: GET endpoints do not accept a body.");
    }
    return listPhoneNumbersRaw(
      client,
      normalizeListPhoneNumbersParams(params) as Parameters<typeof listPhoneNumbersRaw>[1],
      undefined,
      sanitizeBusinessManagementOptions(opts, "listPhoneNumbers")
    );
  },
  { definition: listPhoneNumbersRaw.definition }
) as unknown as {
  (client: Parameters<typeof listPhoneNumbersRaw>[0], params: ListPhoneNumbersInput, body?: never, opts?: EndpointInvokeOptions): Promise<PhoneNumberListResponse>;
  readonly definition: typeof listPhoneNumbersRaw.definition;
};
