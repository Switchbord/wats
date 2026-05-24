# @wats/types

Shared TypeScript contracts for WATS and WhatsApp Cloud API payloads: config, webhook envelopes, message unions, status payloads, contacts, entities, and errors.

## Install

```bash
bun add @wats/types
npm i @wats/types
```

## Usage

```ts
import type { WhatsAppMessage, WhatsAppMessageStatus } from "@wats/types";

function describeMessage(message: WhatsAppMessage): string {
  return message.type;
}

function isRead(status: WhatsAppMessageStatus): boolean {
  return status.status === "read";
}
```

Use this package when you need WATS domain types without the Graph client, webhook adapter, CLI, or service runtime. Runtime helpers live in the other `@wats/*` packages.

Docs: https://github.com/Switchbord/wats
License: MIT
