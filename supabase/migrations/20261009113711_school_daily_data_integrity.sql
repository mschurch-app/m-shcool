begin;
-- Additive only. Mixed legacy dates are deliberately NOT backfilled.
alter table mschool.roll_calls add column class_date date, add column recorded_at timestamptz,
 add column updated_at timestamptz, add column recorded_by text;
create index roll_calls_class_day_idx on mschool.roll_calls(course_name,class_date,student_id);
create index roll_calls_legacy_day_idx on mschool.roll_calls(course_name,((created_at at time zone 'UTC')::date),student_id) where class_date is null;
alter table mschool.points_logs add column actor_id text, add column source text,
 add column balance_after integer, add column request_id uuid;
create index points_logs_person_time_idx on mschool.points_logs(target_id,change_time desc,id desc);
create table mschool.flow_operations(actor_id text not null,kind text not null,request_id uuid not null,
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,kind,request_id));
create table mschool.rollcall_days(course_name text not null,class_date date not null,revision bigint not null default 0,
 primary key(course_name,class_date));
alter table mschool.flow_operations enable row level security;
alter table mschool.rollcall_days enable row level security;
revoke all on mschool.flow_operations,mschool.rollcall_days from public,anon,authenticated;

create function mschool.flow_actor(p_actor text,p_write boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
 a:=public.school_resolve_session(p_actor);
 if a is null or a->>'role_type' not in ('同工','老師','工讀生') or (p_write and a->>'role_type'='工讀生') then
 raise exception 'school_access_denied' using errcode='42501'; end if;
 return a;
end $$;
create function mschool.flow_replay(p_actor text,p_kind text,p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r mschool.flow_operations;
begin
 if p_request is null then raise exception 'request_id_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||p_kind||p_request::text,57203));
 select * into r from mschool.flow_operations where actor_id=p_actor and kind=p_kind and request_id=p_request;
 if found then
 if r.payload_hash<>encode(sha256(convert_to(p_payload::text,'UTF8')),'hex') then raise exception 'request_payload_changed' using errcode='40001'; end if;
 return r.result;
 end if;
 return null;
end $$;
create function mschool.flow_record(p_actor text,p_kind text,p_request uuid,p_payload jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 insert into mschool.flow_operations(actor_id,kind,request_id,payload_hash,result)
 values(p_actor,p_kind,p_request,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_result);
 return p_result;
end $$;

create function public.school_rollcall_read(p_actor text,p_start date,p_end date,p_course text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform mschool.flow_actor(p_actor,false);
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>31 then raise exception 'invalid_date_range'; end if;
 return jsonb_build_object('revision',coalesce((select revision::text from mschool.rollcall_days where class_date=p_start and course_name=p_course),'0'),
 'records',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('id',r.id::text,'effective_date',coalesce(r.class_date,(r.created_at at time zone 'UTC')::date),
 'date_basis',case when r.class_date is not null then 'explicit' when extract(hour from r.created_at at time zone 'UTC')=16 then 'legacy' else 'legacy_review' end) order by r.id)
 from mschool.roll_calls r where coalesce(r.class_date,(r.created_at at time zone 'UTC')::date) between p_start and p_end
 and (p_course is null or r.course_name=p_course)),'[]'::jsonb));
end $$;
create function public.school_save_rollcall(p_actor text,p_day date,p_course text,p_rows jsonb,p_revision text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; prior jsonb; payload jsonb; rev bigint; item jsonb; person mschool.users; rid bigint; result jsonb;
begin
 a:=mschool.flow_actor(p_actor);
 if p_day is null or p_course is distinct from '課後輔導' or jsonb_typeof(p_rows) is distinct from 'array'
 or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'invalid_rollcall'; end if;
 payload:=jsonb_build_object('day',p_day,'course',p_course,'rows',p_rows,'revision',p_revision);
 prior:=mschool.flow_replay(a->>'id','rollcall',p_request,payload);if prior is not null then return prior;end if;
 insert into mschool.rollcall_days(course_name,class_date) values(p_course,p_day) on conflict do nothing;
 select revision into rev from mschool.rollcall_days where course_name=p_course and class_date=p_day for update;
 if p_revision is not null and p_revision<>rev::text then raise exception 'rollcall_conflict' using errcode='40001'; end if;
 if (select count(distinct value->>'student_id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'duplicate_student';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
 select * into person from mschool.users where id=item->>'student_id';
 if not found or coalesce(person.role_type,'學生')<>'學生' then raise exception 'student_required';end if;
 if coalesce(item->>'attendance_status','') not in ('出席','請假') or coalesce(item->>'homework_status','') not in ('已完成','未完成')
 or coalesce(item->>'contact_book_signed','') not in ('是','未簽') or length(coalesce(item->>'note',''))>2000 then raise exception 'invalid_rollcall_fields';end if;
 select id into rid from mschool.roll_calls where student_id=person.id and course_name=p_course
 and coalesce(class_date,(created_at at time zone 'UTC')::date)=p_day order by id desc limit 1 for update;
 if found then update mschool.roll_calls set class_date=p_day,student_name=person.name,attendance_status=item->>'attendance_status',
 homework_status=item->>'homework_status',contact_book_signed=item->>'contact_book_signed',note=item->>'note',updated_at=now(),recorded_by=a->>'id' where id=rid;
 else insert into mschool.roll_calls(created_at,class_date,recorded_at,updated_at,recorded_by,course_name,student_id,student_name,attendance_status,homework_status,contact_book_signed,note)
 values((p_day::text||'T16:00:00Z')::timestamptz,p_day,now(),now(),a->>'id',p_course,person.id,person.name,item->>'attendance_status',item->>'homework_status',item->>'contact_book_signed',item->>'note');end if;
 end loop;
 update mschool.rollcall_days set revision=revision+1 where course_name=p_course and class_date=p_day;
 result:=jsonb_build_object('ok',true,'revision',(rev+1)::text,'count',jsonb_array_length(p_rows));
 return mschool.flow_record(a->>'id','rollcall',p_request,payload,result);
end $$;

-- The original validator stays private; the wrapper protects the point balance.
alter function public.school_mutate_users(text,text,text,jsonb,boolean) rename to school_mutate_users_core;
create function public.school_mutate_users(p_actor_hash text,p_method text,p_id text,p_payload jsonb,p_upsert boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb; item jsonb; items jsonb; old mschool.users; result jsonb;new_ids text[]:=array[]::text[];clean_items jsonb:='[]';
begin
 a:=mschool.flow_actor(p_actor_hash);
 if p_method='DELETE' then return public.school_mutate_users_core(p_actor_hash,p_method,p_id,p_payload,p_upsert);end if;
 items:=case when jsonb_typeof(p_payload)='array' then p_payload else jsonb_build_array(p_payload) end;
 if jsonb_array_length(items)>500 or (select count(distinct coalesce(p_id,value->>'id')) from jsonb_array_elements(items))<>jsonb_array_length(items) then raise exception 'invalid_profile_batch';end if;
 for item in select value from jsonb_array_elements(items) loop
 if jsonb_typeof(item) is distinct from 'object' or coalesce(p_id,item->>'id','') !~ '^[A-Za-z0-9_-]{1,64}$' or (item ? 'name' and length(btrim(coalesce(item->>'name',''))) not between 1 and 80) then raise exception 'invalid_person';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_id,item->>'id'),57202));
 select * into old from mschool.users where id=coalesce(p_id,item->>'id') for update;
 if found and item ? 'points' and (item->>'points')::integer is distinct from coalesce(old.points,0) then
 raise exception 'use_points_ledger' using errcode='40001';end if;
 if old.id is null then new_ids:=array_append(new_ids,coalesce(p_id,item->>'id'));else item:=item-'points';end if;
 if old.id is null and item ? 'points' and (coalesce((item->>'points')::bigint,-1)<0 or (item->>'points')::bigint>2147483647) then raise exception 'invalid_points';end if;
 clean_items:=clean_items||jsonb_build_array(item);
 end loop;
 result:=public.school_mutate_users_core(p_actor_hash,p_method,p_id,clean_items,p_upsert);
 -- New rows with an initial balance receive an opening entry, never fabricated historical entries.
 for item in select value from jsonb_array_elements(result) loop
 if item->>'id'=any(new_ids) and coalesce((item->>'points')::integer,0)>0 then
 insert into mschool.points_logs(change_time,target_id,target_name,points_delta,reason,actor_id,source,balance_after)
 values(now(),item->>'id',item->>'name',(item->>'points')::integer,'新增學員起始點數',a->>'id','opening',(item->>'points')::integer);
 end if;
 end loop;
 return result;
end $$;
create function public.school_adjust_points(p_actor text,p_student text,p_delta integer,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; u mschool.users; prior jsonb; payload jsonb; balance bigint;result jsonb;
begin
 a:=mschool.flow_actor(p_actor);
 if p_delta is null or p_delta=0 or abs(p_delta::bigint)>10000 or length(btrim(coalesce(p_reason,''))) not between 1 and 200 then raise exception 'invalid_points_adjustment';end if;
 payload:=jsonb_build_object('student',p_student,'delta',p_delta,'reason',btrim(p_reason));
 prior:=mschool.flow_replay(a->>'id','points',p_request,payload);if prior is not null then return prior;end if;
 select * into u from mschool.users where id=p_student for update;
 if not found or coalesce(u.role_type,'學生')<>'學生' then raise exception 'student_required';end if;
 balance:=coalesce(u.points,0)::bigint+p_delta;
 if balance<0 or balance>2147483647 then raise exception 'invalid_points_balance';end if;
 update mschool.users set points=balance::integer where id=u.id;
 insert into mschool.points_logs(change_time,target_id,target_name,points_delta,reason,actor_id,source,balance_after,request_id)
 values(now(),u.id,u.name,p_delta,btrim(p_reason),a->>'id','adjustment',balance::integer,p_request);
 result:=jsonb_build_object('ok',true,'balance',balance);
 return mschool.flow_record(a->>'id','points',p_request,payload,result);
end $$;
create function public.school_points_history(p_actor text,p_student text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform mschool.flow_actor(p_actor,false);
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.change_time desc,x.id desc) from
 (select * from mschool.points_logs where target_id=p_student order by change_time desc,id desc limit 100) x),'[]'::jsonb);
end $$;

create function mschool.person_can_checkin(p_role text,p_status text) returns boolean
language sql immutable set search_path='' as $$select case when coalesce(p_role,'學生')='學生' then coalesce(p_status,'在班')='在班'
 when p_role in ('同工','老師','工讀生') then coalesce(p_status,'在班') in ('在班','在職') else false end$$;
create or replace function mschool.kiosk_checkin(p_user_id text)
returns jsonb language plpgsql set search_path='' as $$
declare u mschool.users%rowtype; cnt integer; last_time timestamptz; first_time timestamptz; first_action text; in_count integer; out_count integer;
 now_ts timestamptz:=now(); day_start timestamptz; seconds numeric;
begin
 select * into u from mschool.users where upper(id)=upper(btrim(p_user_id)) for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
 if not mschool.person_can_checkin(u.role_type,u.status) then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 day_start:=date_trunc('day',now_ts at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
 select count(*),max(check_time),min(check_time),count(*) filter(where action_text='上班簽到'),count(*) filter(where action_text='下班簽退') into cnt,last_time,first_time,in_count,out_count from mschool.check_in_logs
  where target_id=u.id and check_time>=day_start and check_time<day_start+interval '1 day';
 if coalesce(u.role_type,'學生')='學生' then
  if cnt>0 then return jsonb_build_object('ok',false,'code','already','name',u.name); end if;
  update mschool.users set points=coalesce(points,0)+1 where id=u.id;
  insert into mschool.points_logs(change_time,target_id,target_name,points_delta,reason,source,balance_after) values(now_ts,u.id,u.name,1,'準時簽到','attendance',coalesce(u.points,0)+1);
  insert into mschool.check_in_logs(check_time,target_id,target_name,role,action_text) values(now_ts,u.id,u.name,'學生','+1 點 (到班)');
  return jsonb_build_object('ok',true,'kind','student','name',u.name,'title','🎉 '||u.name||' 到班成功！','subtitle','出席已記錄，點數 +1！');
 end if;
 if cnt>=2 then
  select action_text into first_action from mschool.check_in_logs where target_id=u.id and check_time=first_time order by id limit 1;
  return jsonb_build_object('ok',false,'code',case when cnt=2 and in_count=1 and out_count=1 and first_action='上班簽到' and last_time>first_time then 'already_completed' else 'needs_review' end,'name',u.name);
 end if;
 if last_time is not null and now_ts-last_time<interval '60 seconds' then return jsonb_build_object('ok',false,'code','too_soon','name',u.name); end if;
 if cnt=1 then
  select action_text into first_action from mschool.check_in_logs where target_id=u.id and check_time=first_time order by id limit 1;
  if first_action is distinct from '上班簽到' then return jsonb_build_object('ok',false,'code','needs_review','name',u.name); end if;
  seconds:=extract(epoch from now_ts-first_time);
 end if;
 insert into mschool.check_in_logs(check_time,target_id,target_name,role,action_text)
  values(now_ts,u.id,u.name,coalesce(u.role_type,'教職員'),case when cnt=0 then '上班簽到' else '下班簽退' end);
 return jsonb_build_object('ok',true,'kind','staff','name',u.name,
  'title',case when cnt=0 then '💼 '||u.name||' 上班簽到成功！' else '🌙 '||u.name||' 下班簽退成功！' end,
  'actual_seconds',seconds,'actual_hours',case when seconds is not null then round(seconds/3600,2) end,
  'subtitle',case when cnt=0 then '上班時間已記錄；下班時請再打一次卡。' else '今日實際工時：'||floor(seconds/3600)::text||' 小時 '||floor(mod(seconds,3600)/60)::text||' 分' end);
end $$;
revoke all on function mschool.kiosk_checkin(text) from public,anon,authenticated;
grant execute on function mschool.kiosk_checkin(text) to service_role;


-- Scheduling serializes its small working set and validates adjacent days too.
create function mschool.shift_range(p_day date,p_shift text) returns tsrange
language plpgsql immutable set search_path='' as $$
declare parts text[];start_at timestamp;end_at timestamp;
begin
 parts:=regexp_match(p_shift,'^\s*([0-2][0-9]:[0-5][0-9])\s*-\s*([0-2][0-9]:[0-5][0-9])\s*$');
 if p_day is null or parts is null or left(parts[1],2)::integer>23 or left(parts[2],2)::integer>23 or parts[1]=parts[2] then return null;end if;
 start_at:=p_day+parts[1]::time;end_at:=p_day+parts[2]::time;
 if end_at<start_at then end_at:=end_at+interval '1 day';end if;
 return tsrange(start_at,end_at,'[)');
end $$;
create function public.school_mutate_schedules(p_actor text,p_method text,p_id bigint,p_rows jsonb,p_request uuid,p_preview boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;prior jsonb;payload jsonb;item jsonb;person mschool.users;old mschool.schedules; proposed jsonb:='[]';conflicts jsonb:='[]';
 normalized jsonb;span tsrange;other jsonb;result jsonb;rid bigint;
begin
 a:=mschool.flow_actor(p_actor);
 if p_method not in ('POST','PATCH','DELETE') or (p_method in ('PATCH','DELETE') and p_id is null) then raise exception 'invalid_schedule_operation';end if;
 if p_method='DELETE' and a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 payload:=jsonb_build_object('method',p_method,'id',p_id,'rows',p_rows);
 if not p_preview then prior:=mschool.flow_replay(a->>'id','schedules',p_request,payload);if prior is not null then return prior;end if;end if;
 perform pg_advisory_xact_lock(57203,2);
 if p_method in ('PATCH','DELETE') then
 select * into old from mschool.schedules where id=p_id for update;
 if not found then raise exception 'schedule_missing' using errcode='40001';end if;
 end if;
 if p_method='DELETE' then
 if not p_preview then delete from mschool.schedules where id=p_id;end if;
 result:=jsonb_build_object('ok',true,'count',1,'conflicts','[]'::jsonb);
 else
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 or (p_method='PATCH' and jsonb_array_length(p_rows)<>1) then raise exception 'invalid_schedule_batch';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
 if exists(select 1 from jsonb_object_keys(item) k where k not in ('date','worker_id','worker_name','shift','hours','job_desc','role_type','hourly_wage')) then raise exception 'invalid_schedule_fields';end if;
 if p_method='PATCH' then item:=to_jsonb(old)||item;end if;
 select * into person from mschool.users where id=item->>'worker_id';
 if not found or coalesce(person.role_type,'') not in ('同工','老師','工讀生') or not mschool.person_can_checkin(person.role_type,person.status) then raise exception 'active_worker_required';end if;
 span:=mschool.shift_range((item->>'date')::date,item->>'shift');
 if span is null or length(coalesce(item->>'job_desc',''))>2000 or coalesce((item->>'hourly_wage')::integer,190)<0 then raise exception 'invalid_schedule_fields';end if;
 normalized:=jsonb_build_object('date',item->>'date','worker_id',person.id,'worker_name',person.name,'role_type',person.role_type,
 'shift',to_char(lower(span),'HH24:MI')||' - '||to_char(upper(span),'HH24:MI'),'hours',round(extract(epoch from upper(span)-lower(span))/3600,1),
 'hourly_wage',coalesce((item->>'hourly_wage')::integer,190),'job_desc',coalesce(nullif(item->>'job_desc',''),'課輔陪伴'));
 for other in select to_jsonb(s) from mschool.schedules s where s.worker_id=person.id and (p_id is null or s.id<>p_id)
 and s.date between (item->>'date')::date-1 and (item->>'date')::date+1 loop
 if mschool.shift_range((other->>'date')::date,other->>'shift') is null or mschool.shift_range((other->>'date')::date,other->>'shift') && span then
 conflicts:=conflicts||jsonb_build_array(jsonb_build_object('date',item->>'date','worker_id',person.id,'existing_id',other->>'id','existing_date',other->>'date','shift',other->>'shift'));end if;
 end loop;
 for other in select value from jsonb_array_elements(proposed) loop
 if other->>'worker_id'=person.id and mschool.shift_range((other->>'date')::date,other->>'shift') && span then
 conflicts:=conflicts||jsonb_build_array(jsonb_build_object('date',item->>'date','worker_id',person.id,'existing_date',other->>'date','shift',other->>'shift'));end if;
 end loop;
 proposed:=proposed||jsonb_build_array(normalized);
 end loop;
 if jsonb_array_length(conflicts)>0 then
 if p_preview then return jsonb_build_object('ok',false,'conflicts',conflicts,'proposed',proposed);end if;
 raise exception 'schedule_conflict' using errcode='40001';end if;
 if not p_preview then
 for item in select value from jsonb_array_elements(proposed) loop
 if p_method='PATCH' then
 update mschool.schedules set date=(item->>'date')::date,worker_id=item->>'worker_id',worker_name=item->>'worker_name',role_type=item->>'role_type',
 shift=item->>'shift',hours=(item->>'hours')::numeric,hourly_wage=(item->>'hourly_wage')::integer,job_desc=item->>'job_desc' where id=p_id;
 else
 insert into mschool.schedules(date,worker_id,worker_name,role_type,shift,hours,hourly_wage,job_desc)
 values((item->>'date')::date,item->>'worker_id',item->>'worker_name',item->>'role_type',item->>'shift',(item->>'hours')::numeric,(item->>'hourly_wage')::integer,item->>'job_desc');end if;
 end loop;end if;
 result:=jsonb_build_object('ok',true,'count',jsonb_array_length(proposed),'proposed',proposed,'conflicts',conflicts);
 end if;
 if p_preview then return result;end if;
 return mschool.flow_record(a->>'id','schedules',p_request,payload,result);
end $$;

create function public.school_import_rows(p_actor text,p_rows jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;prior jsonb;item jsonb;old jsonb;mutation jsonb;results jsonb:='[]';result jsonb;field text;failure text;
begin
 a:=mschool.flow_actor(p_actor);
 if a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'invalid_import_batch';end if;
 prior:=mschool.flow_replay(a->>'id','import',p_request,p_rows);if prior is not null then return prior;end if;
 for item in select value from jsonb_array_elements(p_rows) loop
 begin
 if item->>'kind' not in ('insert','update') or nullif(item->>'id','') is null then raise exception 'invalid_import_row';end if;
 perform pg_advisory_xact_lock(hashtextextended(item->>'id',57202));
 select to_jsonb(u) into old from mschool.users u where id=item->>'id' for update;
 if item->>'kind'='update' then
 if old is null or jsonb_typeof(item->'expected') is distinct from 'object' then raise exception 'import_conflict' using errcode='40001';end if;
 for field in select jsonb_object_keys(item->'payload') loop
 if not (item->'expected' ? field) or old->field is distinct from item->'expected'->field then raise exception 'import_conflict' using errcode='40001';end if;
 end loop;
 end if;
 mutation:=public.school_mutate_users(p_actor,case when item->>'kind'='insert' then 'POST' else 'PATCH' end,
 case when item->>'kind'='insert' then null else item->>'id' end,item->'payload',false);
 if jsonb_array_length(mutation)<>1 then raise exception 'import_conflict';end if;
 results:=results||jsonb_build_array(jsonb_build_object('row',item->'row','id',item->>'id','ok',true));
 exception when others then
 get stacked diagnostics failure=returned_sqlstate;
 results:=results||jsonb_build_array(jsonb_build_object('row',item->'row','id',item->>'id','ok',false,'code',failure,
 'error',case when failure='40001' then '資料已變動，請重新預覽' when failure='23505' then '編號已存在，請重新預覽' else '此列未儲存，請檢查欄位與權限' end));
 end;
 end loop;
 result:=jsonb_build_object('results',results,'success',(select count(*) from jsonb_array_elements(results) x where (x->>'ok')::boolean));
 return mschool.flow_record(a->>'id','import',p_request,p_rows,result);
end $$;
create function public.school_import_history(p_actor text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
 a:=mschool.flow_actor(p_actor);if a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from
 (select actor_id,request_id,created_at,result from mschool.flow_operations where kind='import' order by created_at desc limit 20)x),'[]'::jsonb);
end $$;

-- Provision first; enforcement is an explicit manager action after onsite acceptance.
create table mschool.kiosk_devices(id uuid primary key default gen_random_uuid(),label text not null,token_hash text not null unique,
 is_active boolean not null default true,created_by text not null,created_at timestamptz not null default now());
create table mschool.kiosk_policy(id boolean primary key default true check(id),require_device boolean not null default false);
insert into mschool.kiosk_policy values(true,false);
create table mschool.kiosk_rate_buckets(bucket_key text primary key,window_start timestamptz not null,hits integer not null);
create index kiosk_rate_expiry_idx on mschool.kiosk_rate_buckets(window_start);
alter table mschool.kiosk_devices enable row level security;
alter table mschool.kiosk_policy enable row level security;
alter table mschool.kiosk_rate_buckets enable row level security;
revoke all on mschool.kiosk_devices,mschool.kiosk_policy,mschool.kiosk_rate_buckets from public,anon,authenticated;
create function public.school_kiosk_manage(p_actor text,p_action text,p_label text default null,p_hash text default null,p_id uuid default null,p_enforce boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;did uuid;
begin
 a:=mschool.flow_actor(p_actor);if a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(57203,3);
 if p_action='register' then
 if length(btrim(coalesce(p_label,''))) not between 1 and 80 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_device';end if;
 insert into mschool.kiosk_devices(label,token_hash,created_by) values(btrim(p_label),p_hash,a->>'id') returning id into did;
 elsif p_action='revoke' then update mschool.kiosk_devices set is_active=false where id=p_id;
 elsif p_action='policy' then
 if p_enforce is null or (p_enforce and not exists(select 1 from mschool.kiosk_devices where is_active)) then raise exception 'active_device_required';end if;
 update mschool.kiosk_policy set require_device=p_enforce;
 elsif p_action<>'list' then raise exception 'invalid_device_action';end if;
 return jsonb_build_object('created_id',did,'require_device',(select require_device from mschool.kiosk_policy where id),
 'devices',coalesce((select jsonb_agg(to_jsonb(d)-'token_hash' order by created_at desc) from mschool.kiosk_devices d),'[]'::jsonb));
end $$;
create function public.school_kiosk_gate(p_hash text,p_bucket text,p_route text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare trusted boolean;counter integer;global_counter integer;max_hits integer;key text;window_at timestamptz:=date_trunc('minute',now());
begin
 trusted:=exists(select 1 from mschool.kiosk_devices where token_hash=p_hash and is_active);
 if (select require_device from mschool.kiosk_policy where id) and not trusted then return jsonb_build_object('ok',false,'code','device_required');end if;
 if p_route not in ('face-match','check-in','logs') or coalesce(p_bucket,'') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','invalid');end if;
 max_hits:=case p_route when 'face-match' then 1200 when 'check-in' then 180 else 120 end;
 insert into mschool.kiosk_rate_buckets(bucket_key,window_start,hits) values('global:'||p_route,window_at,1)
 on conflict(bucket_key) do update set hits=case when mschool.kiosk_rate_buckets.window_start=window_at then mschool.kiosk_rate_buckets.hits+1 else 1 end,window_start=window_at returning hits into global_counter;
 if global_counter>max_hits*3 then return jsonb_build_object('ok',false,'code','rate_limited');end if;
 key:=coalesce(case when trusted then p_hash end,p_bucket)||':'||p_route;
 insert into mschool.kiosk_rate_buckets(bucket_key,window_start,hits) values(key,window_at,1)
 on conflict(bucket_key) do update set hits=case when mschool.kiosk_rate_buckets.window_start=window_at then mschool.kiosk_rate_buckets.hits+1 else 1 end,window_start=window_at returning hits into counter;
 if global_counter%100=1 then delete from mschool.kiosk_rate_buckets where window_start<window_at-interval '1 hour';end if;
 return jsonb_build_object('ok',counter<=max_hits,'code',case when counter>max_hits then 'rate_limited' else 'ok' end,'trusted',trusted);
end $$;
-- Existing-photo backfill is a compare-and-set operation, never a generic bulk profile patch.
create function public.school_backfill_face(p_actor text,p_id text,p_avatar text,p_status text,p_descriptor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;u mschool.users;
begin
 a:=mschool.flow_actor(p_actor);if a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 if jsonb_typeof(p_descriptor) is distinct from 'array' or jsonb_array_length(p_descriptor)<>128 then raise exception 'invalid_face';end if;
 if exists(select 1 from jsonb_array_elements(p_descriptor) x where jsonb_typeof(x)<>'number' or abs((x#>>'{}')::numeric)>10) then raise exception 'invalid_face';end if;
 select * into u from mschool.users where id=p_id for update;
 if not found or coalesce(u.role_type,'學生')<>'學生' or not mschool.person_can_checkin(u.role_type,u.status)
 or u.avatar_url is distinct from p_avatar or u.status is distinct from p_status or u.face_descriptor is not null then return jsonb_build_object('saved',false);end if;
 update mschool.users set face_descriptor=p_descriptor where id=p_id;
 return jsonb_build_object('saved',true);
end $$;
create function public.school_kiosk_punch(p_scope text,p_id text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior jsonb;payload jsonb:=jsonb_build_object('id',p_id);result jsonb;
begin
 if p_scope is null or p_scope !~ '^[a-f0-9]{64}$' then raise exception 'invalid_device_scope';end if;
 prior:=mschool.flow_replay('kiosk:'||p_scope,'punch',p_request,payload);if prior is not null then return prior;end if;
 result:=mschool.kiosk_checkin(p_id);
 return mschool.flow_record('kiosk:'||p_scope,'punch',p_request,payload,result);
end $$;

-- No direct browser access to any new privileged function, including helpers/core.
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('school_rollcall_read','school_save_rollcall','school_mutate_users','school_mutate_users_core','school_adjust_points',
 'school_points_history','school_mutate_schedules','school_import_rows','school_import_history','school_kiosk_manage','school_kiosk_gate','school_kiosk_punch','school_backfill_face'))
 or (n.nspname='mschool' and p.proname in ('flow_actor','flow_replay','flow_record','person_can_checkin','shift_range')) loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
commit;
