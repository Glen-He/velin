create table "user_avatar" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "contentType" text not null,
  "data" bytea not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);
