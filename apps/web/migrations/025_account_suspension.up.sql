alter table "user" add column disabled_at timestamptz;

-- 与停用事务共享用户行锁，防止登录验证结束后插入一条迟到会话。
create function reject_disabled_user_session() returns trigger language plpgsql as $$
declare disabled timestamptz;
begin
  select disabled_at into disabled from "user" where id = new."userId" for share;
  if disabled is not null then
    raise exception 'Account is disabled' using errcode = '28000';
  end if;
  return new;
end;
$$;
create trigger session_account_access before insert on "session"
for each row execute function reject_disabled_user_session();
