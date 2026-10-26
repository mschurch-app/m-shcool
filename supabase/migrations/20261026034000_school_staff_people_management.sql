begin;
-- Personnel records are school-only. Login grants remain a separate operation.
create function mschool.staff_person_json(p mschool.users) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.name,'role_type',p.role_type,
   'phone',p.phone,'address',p.address,'note',p.note,'status',p.status,
   'version',md5(jsonb_build_array(p.name,p.role_type,p.phone,p.address,p.note,p.status)::text))
$$;
revoke all on function mschool.staff_person_json(mschool.users) from public,anon,authenticated;

create function public.school_staff_people(p_actor text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
 a:=mschool.flow_actor(p_actor,false);
 if a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(mschool.staff_person_json(u)||jsonb_build_object('editable',
   u.id<>a->>'id' and not exists(select 1 from mschool.staff_access s where s.user_id=u.id and s.role_type='同工')) order by u.id)
   from mschool.users u where u.role_type in ('老師','工讀生')),'[]'::jsonb);
end $$;

create function public.school_manage_staff_person(p_actor text,p_action text,p_id text,p_input jsonb,p_expected text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; prior jsonb; payload jsonb; old mschool.users; person mschool.users;
 result jsonb; prefix text; serial bigint; new_id text;
begin
 a:=mschool.flow_actor(p_actor);
 if a->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501';end if;
 if p_action not in ('create','update','delete') or p_action is null
 or jsonb_typeof(p_input) is distinct from 'object'
 or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','role_type','phone','address','note','status')) then
 raise exception 'invalid_staff_fields';end if;
 payload:=jsonb_build_object('action',p_action,'id',p_id,'input',p_input,'expected',p_expected);
 prior:=mschool.flow_replay(a->>'id','staff-people',p_request,payload);
 if prior is not null then return prior;end if;
 -- Same lock order as the dedicated login-access operation, then profile ID lock.
 perform pg_advisory_xact_lock(57202,1);
 if p_action='create' then
   if p_id is not null then raise exception 'staff_id_generated';end if;
   if p_input->>'role_type' is null or p_input->>'role_type' not in ('老師','工讀生') then raise exception 'invalid_staff_role';end if;
   prefix:=to_char(now() at time zone 'Asia/Taipei','YYYY')||case p_input->>'role_type' when '老師' then 'T' else 'P' end;
   select coalesce(max(substring(id from 6)::bigint),0)+1 into serial from mschool.users where id ~ ('^'||prefix||'[0-9]{4}$');
   if serial>9999 then raise exception 'staff_id_exhausted';end if;
   new_id:=prefix||lpad(serial::text,4,'0');
   perform pg_advisory_xact_lock(hashtextextended(new_id,57202));
   person:=jsonb_populate_record(null::mschool.users,jsonb_build_object('id',new_id,'status','在職','points',0,'created_at',now())||p_input);
 else
   if p_id is null or p_id=a->>'id' then raise exception 'school_access_denied' using errcode='42501';end if;
   perform pg_advisory_xact_lock(hashtextextended(p_id,57202));
   select * into old from mschool.users where id=p_id for update;
   if not found or old.role_type not in ('老師','工讀生') or old.role_type is null
   or exists(select 1 from mschool.staff_access s where s.user_id=p_id and s.role_type='同工') then
     raise exception 'school_access_denied' using errcode='42501';end if;
   if p_expected is distinct from (mschool.staff_person_json(old)->>'version') then raise exception 'staff_profile_changed' using errcode='40001';end if;
   if p_action='delete' then
     if p_input<>'{}'::jsonb then raise exception 'invalid_staff_fields';end if;
     person:=old;person.status:='離職';
   else person:=jsonb_populate_record(old,p_input);end if;
 end if;
 if length(btrim(coalesce(person.name,''))) not between 1 and 80
 or person.role_type is null or person.role_type not in ('老師','工讀生')
 or person.status is null or person.status not in ('在班','在職','離職')
 or length(coalesce(person.phone,''))>80 or length(coalesce(person.address,''))>300 or length(coalesce(person.note,''))>2000 then
 raise exception 'invalid_staff_fields';end if;
 if p_action='create' then
   insert into mschool.users(id,name,role_type,status,phone,address,note,points,created_at)
   values(person.id,btrim(person.name),person.role_type,person.status,person.phone,person.address,person.note,0,now()) returning * into person;
 else
   update mschool.users set name=btrim(person.name),role_type=person.role_type,status=person.status,
   phone=person.phone,address=person.address,note=person.note where id=person.id returning * into person;
 end if;
 if person.status='離職' then
   update mschool.staff_access set is_active=false,access_version=access_version+1,updated_at=now() where user_id=person.id and is_active;
   update mschool.api_sessions set revoked_at=now() where user_id=person.id and revoked_at is null;
 end if;
 result:=jsonb_build_object('ok',true,'action',p_action,'person',mschool.staff_person_json(person),'previous_role',old.role_type,'previous_status',old.status);
 return mschool.flow_record(a->>'id','staff-people',p_request,payload,result);
end $$;
revoke all on function public.school_staff_people(text),public.school_manage_staff_person(text,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.school_staff_people(text),public.school_manage_staff_person(text,text,text,jsonb,text,uuid) to service_role;
commit;
