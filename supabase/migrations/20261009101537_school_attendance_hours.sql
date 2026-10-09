begin;
-- Same check-in table and student points; no historical attendance changes.
create or replace function mschool.kiosk_checkin(p_user_id text)
returns jsonb language plpgsql set search_path='' as $$
declare u mschool.users%rowtype; cnt integer; last_time timestamptz; first_time timestamptz; first_action text; in_count integer; out_count integer;
 now_ts timestamptz:=now(); day_start timestamptz; seconds numeric;
begin
 select * into u from mschool.users where upper(id)=upper(btrim(p_user_id)) and coalesce(status,'在班')<>'離職' for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
 day_start:=date_trunc('day',now_ts at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
 select count(*),max(check_time),min(check_time),count(*) filter(where action_text='上班簽到'),count(*) filter(where action_text='下班簽退') into cnt,last_time,first_time,in_count,out_count from mschool.check_in_logs
  where target_id=u.id and check_time>=day_start and check_time<day_start+interval '1 day';
 if coalesce(u.role_type,'學生')='學生' then
  if cnt>0 then return jsonb_build_object('ok',false,'code','already','name',u.name); end if;
  update mschool.users set points=coalesce(points,0)+1 where id=u.id;
  insert into mschool.points_logs(change_time,target_id,target_name,points_delta,reason) values(now_ts,u.id,u.name,1,'準時簽到');
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

create function public.school_workhours_report(p_actor text,p_month date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb; result jsonb; month_start date; month_end date;
begin
 actor:=public.school_resolve_session(p_actor);
 if actor is null or actor->>'role_type'<>'同工' then raise exception 'school_access_denied' using errcode='42501'; end if;
 if p_month is null then raise exception 'invalid_month'; end if;
 month_start:=date_trunc('month',p_month)::date;month_end:=(month_start+interval '1 month')::date;
 with logs as (
  select l.target_id worker_id,(l.check_time at time zone 'Asia/Taipei')::date as "day",max(l.target_name) name,
   count(*) total,count(*) filter(where l.action_text='上班簽到') ins,count(*) filter(where l.action_text='下班簽退') outs,
   min(l.check_time) filter(where l.action_text='上班簽到') clock_in,min(l.check_time) filter(where l.action_text='下班簽退') clock_out
  from mschool.check_in_logs l left join mschool.users u on u.id=l.target_id
  where l.check_time>=month_start::timestamp at time zone 'Asia/Taipei'
   and l.check_time<month_end::timestamp at time zone 'Asia/Taipei'
   and coalesce(nullif(l.role,''),u.role_type,'學生')<>'學生'
  group by l.target_id,(l.check_time at time zone 'Asia/Taipei')::date
 ), plans as (
  select s.worker_id,s.date::date as "day",max(s.worker_name) name,sum(coalesce(s.hours,0)) planned_hours
  from mschool.schedules s left join mschool.users u on u.id=s.worker_id
  where s.date>=month_start and s.date<month_end and coalesce(s.role_type,u.role_type,'教職員')<>'學生'
  group by s.worker_id,s.date
 ), daily as (
  select coalesce(l.worker_id,p.worker_id) worker_id,coalesce(l."day",p."day") as "day",
   coalesce(u.name,l.name,p.name,'未命名') name,coalesce(p.planned_hours,0) planned_hours,l.clock_in,l.clock_out,
   case when l.total=2 and l.ins=1 and l.outs=1 and l.clock_out>l.clock_in then extract(epoch from l.clock_out-l.clock_in) end actual_seconds,
   case when l.total=2 and l.ins=1 and l.outs=1 and l.clock_out>l.clock_in then '已完成'
    when l.total is null and p."day">(now() at time zone 'Asia/Taipei')::date then '尚未到班日'
    when l.total is null then '未打卡，待確認'
    when l.total=1 and l.ins=1 and l."day"=(now() at time zone 'Asia/Taipei')::date then '上班中，尚未下班'
    when l.total=1 and l.ins=1 then '待補下班卡'
    when l.total=1 and l.outs=1 then '待補上班卡'
    else '紀錄異常，待確認' end status
  from logs l full join plans p on l.worker_id=p.worker_id and l."day"=p."day"
  left join mschool.users u on u.id=coalesce(l.worker_id,p.worker_id)
 ), summary as (
  select worker_id,max(name) name,sum(planned_hours) planned_hours,count(*) filter(where actual_seconds is not null) completed_days,
   count(*) filter(where actual_seconds is null and status<>'尚未到班日') pending_days,
   sum(actual_seconds) actual_seconds,round(sum(actual_seconds)/3600,2) actual_hours from daily group by worker_id
 ) select jsonb_build_object('month',to_char(month_start,'YYYY-MM'),
   'days',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('actual_hours',round(actual_seconds/3600,2)) order by "day",worker_id) from daily d),'[]'::jsonb),
   'summary',coalesce((select jsonb_agg(to_jsonb(s) order by worker_id) from summary s),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.school_workhours_report(text,date) from public,anon,authenticated;
grant execute on function public.school_workhours_report(text,date) to service_role;
commit;
