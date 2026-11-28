-- QA FC15-70: the delivery log shows the HTTP status the endpoint gave
-- on the last attempt (null before one, or when it never answered).
alter table public.webhook_deliveries add column last_status_code integer
  check (last_status_code is null or last_status_code between 100 and 599);
