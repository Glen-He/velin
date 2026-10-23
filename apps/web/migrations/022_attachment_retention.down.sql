drop table service_heartbeat;
drop index chat_attachment_source_hash_idx;
alter table chat_attachment drop column source_sha256;
