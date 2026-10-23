drop trigger session_account_access on "session";
drop function reject_disabled_user_session();
alter table "user" drop column disabled_at;
