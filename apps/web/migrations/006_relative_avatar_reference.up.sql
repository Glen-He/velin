-- 自有头像以数据库中的图片为事实来源，地址不再绑定部署域名。
update "user" as account
set "image" = '/api/avatars/' || avatar."userId" || '?v=' ||
    floor(extract(epoch from avatar."updatedAt") * 1000)::bigint::text
from "user_avatar" as avatar
where account."id" = avatar."userId";
