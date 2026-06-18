# WATS-153 reference — advanced template management helpers

Sources: pywa master (client.py/api.py/types/templates.py) + Meta template comparison/migration/archival/auth docs. Base URL Graph v25.0 unless noted. Auth: Bearer token.

## 1. compare_templates
pywa: WhatsApp.compare_templates(template_id, *template_ids, start, end) -> TemplatesCompareResult.
API: GET /{template_id}/compare?template_ids={ids}&start={start}&end={end}
- template_ids: pywa sends comma-joined string. Meta curl shows bracketed list. UNVERIFIED which forms are accepted.
- start/end: Unix timestamps (strings in pywa).
Response:
{ data: [
  { metric:"BLOCK_RATE", type:"RELATIVE", order_by_relative_metric:[templateIds...] },
  { metric:"MESSAGE_SENDS", type:"NUMBER_VALUES", number_values:[{key,value}] },
  { metric:"TOP_BLOCK_REASON", type:"STRING_VALUES", string_values:[{key,value}] }
]}
pywa result fields: block_rate?: string[]; times_sent?: Record<string,number>; top_block_reason?: Record<string,TopBlockReasonType>.
TopBlockReasonType: NO_LONGER_NEEDED, NO_REASON, NO_REASON_GIVEN, NO_SIGN_UP, OFFENSIVE_MESSAGES, OTHER, OTP_DID_NOT_REQUEST, SPAM, UNKNOWN_BLOCK_REASON, UNKNOWN.

## 2. migrate_templates
pywa: WhatsApp.migrate_templates(source_waba_id, page_number?, destination_waba_id?) -> MigrateTemplatesResult.
API: POST /{destination_waba_id}/migrate_message_templates?source_waba_id={src}&page_number={n}
Meta also documents body params not exposed by pywa: count (int max 500), template_ids (string[] max 500).
Response docs: { migrated_templates:[id...], failed_templates:{ id: reason } }
DISCREPANCY: pywa parses failed_templates as list of {id,reason}; likely pywa bug or undocumented alternate response.

## 3. unpause_template
pywa: WhatsApp.unpause_template(template_id) -> TemplateUnpauseResult.
API: POST /{template_id}/unpause ; no body/query.
Meta docs for edge are 404/not listed in Graph ref. UNVERIFIED endpoint/response.
pywa response inferred: { success: boolean, reason?: string }.

## 4. upsert_authentication_template
pywa: WhatsApp.upsert_authentication_template(name,languages,otp_button,add_security_recommendation?,code_expiration_minutes?,message_send_ttl_seconds?,waba_id?) -> CreatedTemplates.
API: POST /{waba_id}/upsert_message_templates
Body:
{ name, languages:[...], category:"AUTHENTICATION", components:[
  { type:"BODY", add_security_recommendation?: boolean },
  { type:"FOOTER", code_expiration_minutes?: number },
  { type:"BUTTONS", buttons:[{ type:"OTP", otp_type:"COPY_CODE"|"ONE_TAP"|"ZERO_TAP", supported_apps?:[{package_name,signature_hash}] }] }
], message_send_ttl_seconds? }
OTP COPY_CODE needs no supported_apps. ONE_TAP/ZERO_TAP need supported_apps. text/autofill_text are not allowed in upsert.
Response: { data:[ { id, status, language } ] }

## 5. archive_templates / unarchive_templates
pywa: archive_templates(template_ids,waba_id?) / unarchive_templates(...)
API: POST https://api.facebook.com/{waba_id}/message_templates/archive or /unarchive (base URL api.facebook.com, not graph.facebook.com)
Body docs: { hsm_ids:[ids] } ; pywa sends {hsm_ids:"id1,id2"}. UNVERIFIED; prefer documented array unless pywa parity intentionally mimics pywa.
Max 100 ids.
Archive response: { archived_templates:[id...], failed_templates:{ id:reason } }
Unarchive: { unarchived_templates:[id...], failed_templates:{ id:reason } }

## 6. library templates
pywa LibraryTemplate is used through standard create_template; no separate library browsing API. Fields: name, library_template_name, category, language, library_template_body_inputs?, library_template_button_inputs?. No public Meta API found to list/browse template library.

## Implementation advice for WATS slices
- Start with compareTemplates and unpauseTemplate: both are template-id scoped, no body mutation ambiguity except unpause's undocumented status.
- Preserve documented Meta shapes but note pywa discrepancies in comments/tests where relevant.
- Keep callables in templates endpoint family and WABAClient/scoped methods where appropriate.
- Do not live-mutate; MockTransport only.
- Follow WATS validator patterns: descriptor-safe records, path id guard, no host TypeError, finite array caps, no token/template body leaks in errors.
