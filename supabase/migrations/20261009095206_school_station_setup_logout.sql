begin;
create or replace function public.school_station_manage(p_actor text,p_id uuid,p_label text,p_enabled boolean,p_pair_hash text,p_credential jsonb)
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
 if p_id is null then perform public.school_revoke_session(p_actor); end if;
 return jsonb_build_object('id',device,'label',trim(p_label),'is_active',p_enabled);
end $$;
commit;
