-- Values a respondent's link carried for the form's declared hidden
-- fields (e.g. ?source=linkedin), captured at start. The logic engine
-- reads them on the server at submission, so the path and ending it
-- computes match what the respondent saw. Client-provided: used for
-- routing and personalisation, never for authorization.
alter table public.responses
  add column hidden_fields jsonb not null default '{}'::jsonb;

alter table public.responses
  add constraint responses_hidden_fields_is_object
  check (jsonb_typeof(hidden_fields) = 'object');
