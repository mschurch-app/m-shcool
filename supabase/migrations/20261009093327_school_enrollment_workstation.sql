begin;
create table mschool.enrollment_devices (
 id uuid primary key default gen_random_uuid(), label text not null,
 pair_hash text not null unique check(pair_hash ~ '^[a-f0-9]{64}$'),
 credential jsonb not null, is_active boolean not null default true,
 version integer not null default 1, attempts integer not null default 0,
 attempt_window timestamptz not null default now(), created_by text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table mschool.enrollment_sessions (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 device_id uuid not null references mschool.enrollment_devices(id), version integer not null,
 expires_at timestamptz not null, last_seen timestamptz not null default now(), revoked_at timestamptz
);
create index enrollment_sessions_device_idx on mschool.enrollment_sessions(device_id);
create table mschool.enrollment_audit (
 id bigint generated always as identity primary key,
 device_id uuid not null references mschool.enrollment_devices(id),
 actor_user_id text, student_id text, event text not null, request_id text, result jsonb, created_at timestamptz not null default now(), unique(device_id,request_id)
);
create index enrollment_audit_device_idx on mschool.enrollment_audit(device_id,created_at desc);
alter table mschool.enrollment_devices enable row level security;
alter table mschool.enrollment_sessions enable row level security;
alter table mschool.enrollment_audit enable row level security;
revoke all on mschool.enrollment_devices,mschool.enrollment_sessions,mschool.enrollment_audit from public,anon,authenticated;
grant all on mschool.enrollment_devices,mschool.enrollment_sessions,mschool.enrollment_audit to service_role;

create function public.school_station_manage(p_actor text,p_id uuid,p_label text,p_enabled boolean,p_pair_hash text,p_credential jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb; device uuid;
begin
 actor:=public.school_resolve_session(p_actor);
 if actor is null or actor->>'role_type'<>'同工' then raise exception 'station_manager_required' using errcode='42501'; end if;
 if p_enabled is null or length(trim(p_label)) not between 2 and 80 then raise exception 'invalid_device'; end if;
 if p_credential is not null and (coalesce(p_credential->>'salt','') !~ '^[a-f0-9]{32}$' or coalesce(p_credential->>'hash','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_credential->>'iterations','')<>'600000' or not(p_credential ?& array['salt','hash','iterations'])) then raise exception 'invalid_credential'; end if;
 if p_id is null then
  if p_credential is null or p_pair_hash is null or p_pair_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_device'; end if;
  insert into mschool.enrollment_devices(label,pair_hash,credential,is_active,created_by)
   values(trim(p_label),p_pair_hash,p_credential,p_enabled,actor->>'id') returning id into device;
 else
  update mschool.enrollment_devices set label=trim(p_label),is_active=p_enabled,credential=coalesce(p_credential,credential),
   version=version+1,attempts=0,attempt_window=now(),updated_at=now() where id=p_id returning id into device;
  if not found then raise exception 'device_not_found'; end if;
  update mschool.enrollment_sessions set revoked_at=now() where device_id=device and revoked_at is null;
 end if;
 insert into mschool.enrollment_audit(device_id,actor_user_id,event) values(device,actor->>'id',case when p_id is null then 'device_enabled' else 'device_updated' end);
 return jsonb_build_object('id',device,'label',trim(p_label),'is_active',p_enabled);
end $$;
create function public.school_station_devices(p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb;
begin
 actor:=public.school_resolve_session(p_actor);
 if actor is null or actor->>'role_type'<>'同工' then raise exception 'station_manager_required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'is_active',d.is_active,'updated_at',d.updated_at) order by d.created_at)
  from mschool.enrollment_devices d),'[]'::jsonb);
end $$;
create function public.school_station_login_prepare(p_pair_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d mschool.enrollment_devices;
begin
 select * into d from mschool.enrollment_devices where pair_hash=p_pair_hash and is_active for update;
 if not found then return null; end if;
 if d.attempt_window>now()-interval '15 minutes' and d.attempts>=5 then return jsonb_build_object('blocked',true); end if;
 update mschool.enrollment_devices set attempts=case when attempt_window<=now()-interval '15 minutes' then 1 else attempts+1 end,
  attempt_window=case when attempt_window<=now()-interval '15 minutes' then now() else attempt_window end where id=d.id;
 return jsonb_build_object('id',d.id,'version',d.version,'credential',d.credential);
end $$;
create function public.school_station_login_finish(p_pair_hash text,p_version integer,p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d mschool.enrollment_devices;
begin
 select * into d from mschool.enrollment_devices where pair_hash=p_pair_hash and is_active and version=p_version for update;
 if not found then return null; end if;
 insert into mschool.enrollment_sessions(token_hash,device_id,version,expires_at) values(p_session_hash,d.id,d.version,now()+interval '4 hours');
 update mschool.enrollment_devices set attempts=0 where id=d.id;
 insert into mschool.enrollment_audit(device_id,event) values(d.id,'session_started');
 return jsonb_build_object('device_id',d.id,'label',d.label);
end $$;
create function public.school_station_session(p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update mschool.enrollment_sessions s set last_seen=now() from mschool.enrollment_devices d
 where s.token_hash=p_hash and s.device_id=d.id and d.is_active and s.version=d.version
  and s.revoked_at is null and s.expires_at>now() and s.last_seen>now()-interval '15 minutes'
 returning jsonb_build_object('device_id',d.id,'label',d.label) into result;
 return result;
end $$;
create function public.school_station_logout(p_hash text)
returns void language sql security definer set search_path='' as $$
 update mschool.enrollment_sessions set revoked_at=now() where token_hash=p_hash and revoked_at is null
$$;
create function public.school_station_students(p_hash text,p_search text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare station jsonb;
begin
 station:=public.school_station_session(p_hash);
 if station is null then raise exception 'station_session_expired' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(s)) from (
  select id,name,school,grade,avatar_url,face_descriptor is not null as has_face from mschool.users
  where coalesce(role_type,'學生')='學生' and coalesce(status,'在班') not in ('離職','退班','畢業')
   and (name ilike '%'||left(coalesce(p_search,''),80)||'%' or id ilike '%'||left(coalesce(p_search,''),80)||'%')
  order by id limit 50
 ) s),'[]'::jsonb);
end $$;
create function public.school_station_save(p_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare station jsonb; student mschool.users; student_id text; year_prefix text; seq bigint; photo text; prior jsonb;
begin
 station:=public.school_station_session(p_hash);
 if station is null then raise exception 'station_session_expired' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','name','school','grade','avatar_url','face_descriptor','request_id')) then raise exception 'station_fields_denied' using errcode='42501'; end if;
 if length(trim(coalesce(p_payload->>'name',''))) not between 1 and 80 or length(coalesce(p_payload->>'school',''))>120 or length(coalesce(p_payload->>'grade',''))>40 then raise exception 'invalid_student'; end if;
 photo:=p_payload->>'avatar_url';
 if photo is null or photo !~ ('^mschool-avatar://enrollment/'||(station->>'device_id')||'/[a-f0-9]{64}\.(jpg|png|webp)$')
  or not exists(select 1 from storage.objects where bucket_id='mschool-avatars' and name=substring(photo from 18)) then raise exception 'station_photo_required'; end if;
 if jsonb_typeof(p_payload->'face_descriptor') is distinct from 'array' then raise exception 'invalid_face'; end if;
 if jsonb_array_length(p_payload->'face_descriptor')<>128 or exists(select 1 from jsonb_array_elements(p_payload->'face_descriptor') x where jsonb_typeof(x)<>'number') then raise exception 'invalid_face'; end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'face_descriptor') x where abs(x::text::numeric)>10) then raise exception 'invalid_face'; end if;
 if p_payload ? 'request_id' then
  if coalesce(p_payload->>'request_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtext(station->>'device_id'),hashtext(p_payload->>'request_id'));
  select result into prior from mschool.enrollment_audit where device_id=(station->>'device_id')::uuid and request_id=p_payload->>'request_id';
  if found then return prior; end if;
 end if;
 student_id:=nullif(p_payload->>'id','');
 if student_id is null then
  perform pg_advisory_xact_lock(57203,1);
  year_prefix:=to_char(now() at time zone 'Asia/Taipei','YYYY')||'S';
  select coalesce(max(substring(id from length(year_prefix)+1)::bigint),0)+1 into seq from mschool.users where id ~ ('^'||year_prefix||'[0-9]{4,8}$');
  student_id:=year_prefix||lpad(seq::text,greatest(4,length(seq::text)), '0');
  insert into mschool.users(id,name,role_type,status,school,grade,avatar_url,face_descriptor,points)
   values(student_id,trim(p_payload->>'name'),'學生','在班',p_payload->>'school',p_payload->>'grade',photo,p_payload->'face_descriptor',0) returning * into student;
 else
  select * into student from mschool.users where id=student_id for update;
  if not found or coalesce(student.role_type,'學生')<>'學生' or coalesce(student.status,'在班') in ('離職','退班','畢業') then raise exception 'station_student_only' using errcode='42501'; end if;
  update mschool.users set name=trim(p_payload->>'name'),school=coalesce(p_payload->>'school',school),grade=coalesce(p_payload->>'grade',grade),avatar_url=photo,face_descriptor=p_payload->'face_descriptor' where id=student_id returning * into student;
 end if;
 insert into mschool.enrollment_audit(device_id,student_id,event,request_id,result) values((station->>'device_id')::uuid,student.id,case when nullif(p_payload->>'id','') is null then 'student_created' else 'student_photo_updated' end,p_payload->>'request_id',jsonb_build_object('id',student.id,'name',student.name,'has_face',true));
 return jsonb_build_object('id',student.id,'name',student.name,'has_face',true);
end $$;
revoke all on function public.school_station_manage(text,uuid,text,boolean,text,jsonb),public.school_station_devices(text),
 public.school_station_login_prepare(text),public.school_station_login_finish(text,integer,text),public.school_station_session(text),
 public.school_station_logout(text),public.school_station_students(text,text),public.school_station_save(text,jsonb) from public,anon,authenticated;
grant execute on function public.school_station_manage(text,uuid,text,boolean,text,jsonb),public.school_station_devices(text),
 public.school_station_login_prepare(text),public.school_station_login_finish(text,integer,text),public.school_station_session(text),
 public.school_station_logout(text),public.school_station_students(text,text),public.school_station_save(text,jsonb) to service_role;
commit;
