-- 恢复版本不能把旧陈述标成刚刚发生的更正。
alter table chat_branch_message add column message_updated_at timestamptz;
-- 旧快照没有当时的更新时间，只能按消息创建时间保守回填，不推测丢失的历史。
update chat_branch_message s set message_updated_at=m.created_at from chat_message m where m.id=s.message_id;
alter table chat_branch_message alter column message_updated_at set not null;
