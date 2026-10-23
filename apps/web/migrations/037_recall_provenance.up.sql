-- 派生回复保留依赖标识，源记忆删除或更正后不能通过旧助手回复绕过遗忘。
alter table chat_message add column recall_dependencies jsonb not null default '{"complete":true,"messages":[],"memories":[]}';
alter table chat_branch_message add column recall_dependencies jsonb not null default '{"complete":true,"messages":[],"memories":[]}';
-- 旧回复没有完整依赖记录，不能声称已完成追溯；原始用户消息继续正常参与检索。
update chat_message set recall_dependencies = '{"complete":false,"messages":[],"memories":[]}' where role = 'assistant';
update chat_branch_message set recall_dependencies = '{"complete":false,"messages":[],"memories":[]}' where message_id in (select id from chat_message where role = 'assistant');
