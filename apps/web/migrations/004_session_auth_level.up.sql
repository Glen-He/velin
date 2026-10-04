alter table "session"
  add column "amr" text,
  add column "verifiedAt" timestamptz,
  add column "stepUpLevel" integer default 1 not null;
