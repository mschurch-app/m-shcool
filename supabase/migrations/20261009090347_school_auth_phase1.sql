-- Additive authentication boundary. Business records and kiosk RPCs are retained.
begin;
create table mschool.staff_access (
  user_id text primary key references mschool.users(id) on delete cascade,
  auth_user_id uuid not null unique references church_auth.accounts(user_id),
  role_type text not null check (role_type in ('同工','老師','工讀生')),
  is_active boolean not null default true,
  access_version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table mschool.staff_access enable row level security;
revoke all on mschool.staff_access from public, anon, authenticated;
grant all on mschool.staff_access to service_role;
alter table mschool.api_sessions add column auth_user_id uuid,
  add column auth_session_id uuid, add column access_version integer,
  add column revoked_at timestamptz;
create index api_sessions_user_active_idx on mschool.api_sessions(user_id) where revoked_at is null;
create index api_sessions_auth_user_idx on mschool.api_sessions(auth_user_id);

-- One-time migration of existing staff only. Approved Church OS aliases collapse
-- to a canonical account; an ambiguous/unmatched identity aborts the transaction.
do $$ begin
  if exists (
    select u.id from mschool.users u
    left join church_auth.accounts a on a.display_name=u.name and a.is_active
    where u.role_type in ('同工','老師','工讀生') and u.status is distinct from '離職'
    group by u.id having count(distinct church_auth.canonical_account(a.user_id))<>1
  ) then raise exception 'school_identity_mapping_requires_review'; end if;
end $$;
insert into mschool.staff_access(user_id,auth_user_id,role_type)
select u.id,min(church_auth.canonical_account(a.user_id)::text)::uuid,u.role_type
from mschool.users u join church_auth.accounts a on a.display_name=u.name and a.is_active
where u.role_type in ('同工','老師','工讀生') and u.status is distinct from '離職'
group by u.id,u.role_type;

create function public.school_staff_identity(p_auth uuid,p_auth_session uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('user',(to_jsonb(u)-'face_descriptor') || jsonb_build_object('role_type',s.role_type),
    'access_version',s.access_version)
  from mschool.staff_access s join mschool.users u on u.id=s.user_id
  join church_auth.accounts a on a.user_id=s.auth_user_id and a.is_active
  join church_auth.accounts original on original.user_id=p_auth and original.is_active
  where s.auth_user_id=church_auth.canonical_account(p_auth) and s.is_active
    and u.status is distinct from '離職'
    and exists(select 1 from auth.sessions x where x.id=p_auth_session and x.user_id=p_auth)
    and exists(select 1 from church_auth.account_home_preferences h where h.user_id=s.auth_user_id and h.church_id='M+'
      and h.home_modules && array['school','school_checkin','school_schedules','school_rollcall','school_students','school_counseling','school_reports']::text[])
    and (exists(select 1 from church_auth.grants g where g.user_id=s.auth_user_id and g.church_id='M+')
      or exists(select 1 from church_auth.owners o where o.user_id=s.auth_user_id))
$$;

create function public.school_issue_session(p_auth uuid,p_auth_session uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb;
begin
  if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_session'; end if;
  identity:=public.school_staff_identity(p_auth,p_auth_session);
  if identity is null then return null; end if;
  insert into mschool.api_sessions(token_hash,user_id,expires_at,auth_user_id,auth_session_id,access_version)
  values(p_hash,identity->'user'->>'id',now()+interval '12 hours',p_auth,p_auth_session,(identity->>'access_version')::integer);
  return identity->'user';
end $$;

create function public.school_resolve_session(p_hash text)
returns jsonb language sql stable security definer set search_path='' as $$
  select identity->'user' from mschool.api_sessions s
  cross join lateral (select public.school_staff_identity(s.auth_user_id,s.auth_session_id) identity) i
  where s.token_hash=p_hash and s.revoked_at is null and s.expires_at>now()
    and identity->'user'->>'id'=s.user_id
    and (identity->>'access_version')::integer=s.access_version
$$;

create function public.school_revoke_session(p_hash text)
returns void language sql security definer set search_path='' as $$
  update mschool.api_sessions set revoked_at=now() where token_hash=p_hash and revoked_at is null
$$;

-- Profile edits never grant login rights. The dedicated access operation is the
-- only operation that changes a linked staff role, and revokes all its sessions.
create function public.school_set_staff_access(p_actor_hash text,p_user text,p_auth uuid,p_role text,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb; target mschool.users; canonical uuid;
begin
  perform pg_advisory_xact_lock(57202,1);
  actor:=public.school_resolve_session(p_actor_hash);
  if actor is null or actor->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501'; end if;
  if actor->>'id'=p_user then raise exception 'school_self_access_change_denied' using errcode='42501'; end if;
  if p_role not in ('同工','老師','工讀生') or p_active is null then raise exception 'invalid_staff_access'; end if;
  select * into target from mschool.users where id=p_user for update;
  if not found or target.role_type='學生' then raise exception 'staff_profile_required'; end if;
  canonical:=church_auth.canonical_account(p_auth);
  if not exists(select 1 from church_auth.accounts where user_id=canonical and is_active)
    or not exists(select 1 from church_auth.account_home_preferences h where h.user_id=canonical and h.church_id='M+'
      and h.home_modules && array['school','school_checkin','school_schedules','school_rollcall','school_students','school_counseling','school_reports']::text[])
    or not (exists(select 1 from church_auth.grants where user_id=canonical and church_id='M+')
      or exists(select 1 from church_auth.owners where user_id=canonical)) then raise exception 'church_account_required'; end if;
  insert into mschool.staff_access(user_id,auth_user_id,role_type,is_active)
  values(p_user,canonical,p_role,p_active)
  on conflict(user_id) do update set auth_user_id=excluded.auth_user_id,role_type=excluded.role_type,
    is_active=excluded.is_active,access_version=mschool.staff_access.access_version+1,updated_at=now();
  update mschool.users set role_type=p_role where id=p_user;
  update mschool.api_sessions set revoked_at=now() where user_id=p_user and revoked_at is null;
  return jsonb_build_object('ok',true);
end $$;

create function public.school_access_options(p_actor_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb;
begin
  actor:=public.school_resolve_session(p_actor_hash);
  if actor is null or actor->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501'; end if;
  return jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(s)) from mschool.staff_access s),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'display_name',a.display_name) order by a.display_name)
      from church_auth.accounts a where a.is_active and church_auth.canonical_account(a.user_id)=a.user_id
        and exists(select 1 from church_auth.account_home_preferences h where h.user_id=a.user_id and h.church_id='M+'
          and h.home_modules && array['school','school_checkin','school_schedules','school_rollcall','school_students','school_counseling','school_reports']::text[])
        and (exists(select 1 from church_auth.grants g where g.user_id=a.user_id and g.church_id='M+')
          or exists(select 1 from church_auth.owners o where o.user_id=a.user_id))),'[]'::jsonb));
end $$;

-- All users mutations run in one transaction, with row locks and server-side
-- field validation. Upserts cannot overwrite a staff row with student data.
create function public.school_mutate_users(p_actor_hash text,p_method text,p_id text,p_payload jsonb,p_upsert boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb; item jsonb; old_row mschool.users; merged mschool.users;
  rows jsonb:='[]'::jsonb; items jsonb; columns_sql text; values_sql text;
begin
  actor:=public.school_resolve_session(p_actor_hash);
  if actor is null or actor->>'role_type' not in ('同工','老師') then raise exception 'school_access_denied' using errcode='42501'; end if;
  if p_method not in ('POST','PATCH','DELETE') then raise exception 'invalid_method'; end if;
  if p_method in ('PATCH','DELETE') and nullif(p_id,'') is null then raise exception 'single_person_required'; end if;
  if p_method='DELETE' then
    if actor->>'role_type'<>'同工' or actor->>'id'=p_id then raise exception 'school_access_denied' using errcode='42501'; end if;
    delete from mschool.users where id=p_id returning * into old_row;
    if found then return jsonb_build_array(to_jsonb(old_row)-'face_descriptor'); end if;
    return rows;
  end if;
  items:=case when jsonb_typeof(p_payload)='array' then p_payload else jsonb_build_array(p_payload) end;
  if jsonb_array_length(items)>500 or (p_method='PATCH' and jsonb_array_length(items)<>1) then raise exception 'invalid_batch'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object' or exists (
      select 1 from jsonb_object_keys(item) k where not exists(
        select 1 from pg_attribute where attrelid='mschool.users'::regclass and attname=k and attnum>0 and not attisdropped)
    ) then raise exception 'invalid_profile_fields'; end if;
    if p_method='PATCH' then
      if item ? 'id' and item->>'id'<>p_id then raise exception 'person_id_immutable'; end if;
      item:=item || jsonb_build_object('id',p_id);
    end if;
    if nullif(item->>'id','') is null then raise exception 'person_id_required'; end if;
    -- Serializes concurrent insert/upsert of the same ID as well as updates.
    perform pg_advisory_xact_lock(hashtextextended(item->>'id',57202));
    select * into old_row from mschool.users where id=item->>'id' for update;
    if found then
      if p_method='POST' and not p_upsert then raise unique_violation using message='person_exists'; end if;
      if item ? 'role_type' and item->>'role_type' is distinct from old_row.role_type then
        raise exception 'use_staff_access_management' using errcode='42501'; end if;
      if old_row.role_type in ('同工','老師','工讀生') and item ? 'status'
        and item->>'status' is distinct from old_row.status
        and (actor->>'role_type'<>'同工' or actor->>'id'=old_row.id) then
        raise exception 'staff_status_change_denied' using errcode='42501'; end if;
      merged:=jsonb_populate_record(old_row,item);
      select string_agg(format('%I',attname),',' order by attnum),
        string_agg(format('($1).%I',attname),',' order by attnum)
      into columns_sql,values_sql from pg_attribute
      where attrelid='mschool.users'::regclass and attnum>0 and not attisdropped and attname<>'id';
      execute format('update mschool.users set (%s)=(select %s) where id=$2',columns_sql,values_sql) using merged,old_row.id;
    else
      if p_method='PATCH' then continue; end if;
      if coalesce(item->>'role_type','學生') not in ('學生','同工','老師','工讀生')
        or (actor->>'role_type'='老師' and coalesce(item->>'role_type','學生')<>'學生') then
        raise exception 'staff_creation_denied' using errcode='42501'; end if;
      item:=jsonb_build_object('created_at',now(),'points',0,'role_type','學生') || item;
      merged:=jsonb_populate_record(null::mschool.users,item);
      select string_agg(format('%I',attname),',' order by attnum),
        string_agg(format('($1).%I',attname),',' order by attnum)
      into columns_sql,values_sql from pg_attribute
      where attrelid='mschool.users'::regclass and attnum>0 and not attisdropped and item ? attname;
      execute format('insert into mschool.users (%s) select %s returning *',columns_sql,values_sql) into merged using merged;
    end if;
    if merged.status='離職' then update mschool.api_sessions set revoked_at=now() where user_id=merged.id and revoked_at is null; end if;
    rows:=rows || jsonb_build_array(to_jsonb(merged)-'face_descriptor');
  end loop;
  return rows;
end $$;

revoke all on function public.school_staff_identity(uuid,uuid),public.school_issue_session(uuid,uuid,text),
  public.school_resolve_session(text),public.school_revoke_session(text),
  public.school_set_staff_access(text,text,uuid,text,boolean),public.school_access_options(text),public.school_mutate_users(text,text,text,jsonb,boolean)
from public,anon,authenticated;
grant execute on function public.school_staff_identity(uuid,uuid),public.school_issue_session(uuid,uuid,text),
  public.school_resolve_session(text),public.school_revoke_session(text),
  public.school_set_staff_access(text,text,uuid,text,boolean),public.school_access_options(text),public.school_mutate_users(text,text,text,jsonb,boolean)
to service_role;
commit;
