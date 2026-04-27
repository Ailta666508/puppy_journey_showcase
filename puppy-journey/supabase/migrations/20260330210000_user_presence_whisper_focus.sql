-- 悄悄话未读 / 正文、专注状态均记在 user_presence（按 profile 一行），与 achievement_tasks 无关。
alter table public.user_presence
  add column if not exists unread_whispers integer default 0,
  add column if not exists last_whisper_received text,
  add column if not exists is_focusing boolean default false;

comment on column public.user_presence.unread_whispers is '对方发来的悄悄话未读条数（记在接收方 profile 行）';
comment on column public.user_presence.last_whisper_received is '对方最近一次写入本行的悄悄话正文（已读后保留展示）';
comment on column public.user_presence.is_focusing is '成就页「专注中」，对侣可见';

update public.user_presence set unread_whispers = 0 where unread_whispers is null;
update public.user_presence set is_focusing = false where is_focusing is null;
