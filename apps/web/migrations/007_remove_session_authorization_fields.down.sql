-- 回滚 schema 只恢复字段定义；历史值已删除，不能作为授权依据。
alter table "session"
  add column "verifiedAt" timestamptz,
  add column "stepUpLevel" integer default 1 not null;
