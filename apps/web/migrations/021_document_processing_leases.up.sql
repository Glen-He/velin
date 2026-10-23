create table document_processing_lease (
  user_id text primary key references "user" (id) on delete cascade,
  lease_id uuid not null unique,
  expires_at timestamptz not null
);
create index document_processing_lease_expiry_idx on document_processing_lease (expires_at);
