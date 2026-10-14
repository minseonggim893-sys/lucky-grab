-- Lucky Grab schema (applied 2026-10-14 as migration lucky_grab_schema)
-- Project: lucky-grab (jjfsfeyffljxosreoxyu, ap-northeast-2)
-- Design: all writes go through SECURITY DEFINER RPCs. Clients (anon key) can only
--   - read public.plays (for realtime results on the big screen)
--   - call the granted RPCs below
-- Tables are otherwise locked by RLS + revoke.

create table public.events(
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                 -- short public id used in URLs/QR (?e=slug)
  title text not null,
  subtitle text not null default '',
  mode text not null default 'stock' check (mode in ('stock','weight')), -- stock: odds ∝ remaining stock / weight: fixed weights
  blank_enabled boolean not null default true,
  blank_weight int not null default 30 check (blank_weight >= 0),
  blank_name text not null default '다음 기회에!',
  one_per_player boolean not null default true,
  is_open boolean not null default true,
  theme jsonb not null default '{}'::jsonb,
  admin_key text not null default replace(gen_random_uuid()::text,'-',''), -- secret for screen/admin pages
  token text, prev_token text, token_at timestamptz, -- rotating QR token (anti link-sharing)
  seq int not null default 0,                -- running play counter
  created_at timestamptz not null default now()
);

create table public.prizes(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  color text not null default '#e2493f',
  shape text not null default 'sphere',      -- sphere | stripe | star | clover | glass (3D capsule look)
  stock int not null default 0 check (stock >= 0),
  initial int not null default 0,
  weight int not null default 1 check (weight >= 0),
  sort int not null default 0
);
create index on public.prizes(event_id);

create table public.plays(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  seq int not null,
  prize_id uuid references public.prizes(id) on delete set null,
  prize_name text not null,
  color text not null,
  shape text not null default 'sphere',
  win boolean not null,
  kiosk boolean not null default false,      -- true = drawn from the big-screen button
  claimed boolean not null default false,    -- staff marks prize handed out
  created_at timestamptz not null default now()
);
create index on public.plays(event_id, created_at desc);

create table public.players(
  event_id uuid not null references public.events(id) on delete cascade,
  player_id text not null,                   -- random id kept in phone localStorage
  play_id uuid references public.plays(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(event_id, player_id)
);

create table public.app_settings(k text primary key, v text not null);
insert into public.app_settings values ('master_code', substr(md5(random()::text || clock_timestamp()::text), 1, 8));

alter table public.events enable row level security;
alter table public.prizes enable row level security;
alter table public.plays enable row level security;
alter table public.players enable row level security;
alter table public.app_settings enable row level security;
revoke all on public.events, public.prizes, public.players, public.app_settings from anon, authenticated;
revoke all on public.plays from anon, authenticated;
grant select on public.plays to anon, authenticated;
create policy "plays are public results" on public.plays for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.plays;

-- ---------- helpers ----------
create or replace function public._auth(p_slug text, p_key text) returns public.events
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  select * into e from events where slug = p_slug;
  if not found or e.admin_key is distinct from p_key then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return e;
end $$;

create or replace function public._event_json(e public.events) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'title', e.title, 'subtitle', e.subtitle,
    'mode', e.mode, 'blank_enabled', e.blank_enabled, 'blank_weight', e.blank_weight,
    'blank_name', e.blank_name, 'one_per_player', e.one_per_player, 'is_open', e.is_open,
    'theme', e.theme, 'seq', e.seq,
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'color',p.color,'shape',p.shape,
       'stock',p.stock,'initial',p.initial,'weight',p.weight) order by p.sort, p.name)
       from prizes p where p.event_id = e.id), '[]'::jsonb));
$$;

create or replace function public._draw(e public.events, p_kiosk boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tot numeric := 0; r numeric; acc numeric := 0;
  pr record; chosen public.prizes; got boolean := false;
  v_seq int; v_play public.plays;
begin
  for pr in select p.*, case when e.mode = 'stock' then p.stock else p.weight end as w
            from prizes p where p.event_id = e.id and p.stock > 0 loop
    if pr.w > 0 then tot := tot + pr.w; end if;
  end loop;
  if tot = 0 then return jsonb_build_object('error','soldout'); end if;
  if e.blank_enabled then tot := tot + e.blank_weight; end if;
  r := random() * tot;
  for pr in select p.*, case when e.mode = 'stock' then p.stock else p.weight end as w
            from prizes p where p.event_id = e.id and p.stock > 0 order by p.sort, p.name loop
    if pr.w > 0 then
      acc := acc + pr.w;
      if r < acc then
        update prizes set stock = stock - 1 where id = pr.id returning * into chosen;
        got := true; exit;
      end if;
    end if;
  end loop;
  update events set seq = seq + 1 where id = e.id returning seq into v_seq;
  if got then
    insert into plays(event_id, seq, prize_id, prize_name, color, shape, win, kiosk)
    values (e.id, v_seq, chosen.id, chosen.name, chosen.color, chosen.shape, true, p_kiosk) returning * into v_play;
  else
    insert into plays(event_id, seq, prize_name, color, shape, win, kiosk)
    values (e.id, v_seq, e.blank_name, '#d7dae3', 'sphere', false, p_kiosk) returning * into v_play;
  end if;
  return jsonb_build_object('play_id', v_play.id, 'seq', v_play.seq, 'win', v_play.win,
    'prize_name', v_play.prize_name, 'color', v_play.color, 'shape', v_play.shape);
end $$;

-- ---------- public (phone) ----------
create or replace function public.get_event(p_slug text) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare e public.events;
begin
  select * into e from events where slug = p_slug;
  if not found then return null; end if;
  return _event_json(e);
end $$;

create or replace function public.draw(p_slug text, p_token text, p_player text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; prev public.players; res jsonb;
begin
  select * into e from events where slug = p_slug for update;
  if not found then return jsonb_build_object('error','no_event'); end if;
  if not e.is_open then return jsonb_build_object('error','closed'); end if;
  if p_token is null or e.token is null or e.token_at < now() - interval '10 minutes'
     or not (p_token = e.token or (p_token = e.prev_token and e.token_at > now() - interval '3 minutes')) then
    return jsonb_build_object('error','expired');
  end if;
  if length(coalesce(p_player,'')) < 8 then return jsonb_build_object('error','bad_player'); end if;
  if e.one_per_player then
    select * into prev from players where event_id = e.id and player_id = p_player;
    if found then
      return (select jsonb_build_object('error','already','play_id',pl.id,'seq',pl.seq,'win',pl.win,
               'prize_name',pl.prize_name,'color',pl.color,'shape',pl.shape)
              from plays pl where pl.id = prev.play_id);
    end if;
  end if;
  res := _draw(e, false);
  if res ? 'error' then return res; end if;
  if e.one_per_player then
    insert into players(event_id, player_id, play_id) values (e.id, p_player, (res->>'play_id')::uuid);
  end if;
  return res;
end $$;

-- ---------- screen / staff (need admin_key) ----------
create or replace function public.rotate_token(p_slug text, p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  e := _auth(p_slug, p_key);
  if e.token is null or e.token_at < now() - interval '50 seconds' then
    update events set prev_token = token,
      token = substr(md5(random()::text || clock_timestamp()::text), 1, 10), token_at = now()
    where id = e.id returning * into e;
  end if;
  return e.token;
end $$;

create or replace function public.kiosk_draw(p_slug text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  perform _auth(p_slug, p_key);
  select * into e from events where slug = p_slug for update;
  if not e.is_open then return jsonb_build_object('error','closed'); end if;
  return _draw(e, true);
end $$;

create or replace function public.admin_get(p_slug text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  e := _auth(p_slug, p_key);
  return _event_json(e) || jsonb_build_object(
    'plays', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq desc) from
       (select id, seq, prize_name, color, win, kiosk, claimed, created_at from plays where event_id = e.id order by seq desc limit 1000) x), '[]'::jsonb));
end $$;

create or replace function public.admin_save(p_slug text, p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; it jsonb; i int := 0; keep uuid[] := '{}'; cur public.prizes; ns int;
begin
  e := _auth(p_slug, p_key);
  update events set
    title = coalesce(nullif(trim(p->>'title'),''), title),
    subtitle = coalesce(p->>'subtitle', subtitle),
    mode = coalesce(p->>'mode', mode),
    blank_enabled = coalesce((p->>'blank_enabled')::boolean, blank_enabled),
    blank_weight = greatest(0, coalesce((p->>'blank_weight')::int, blank_weight)),
    blank_name = coalesce(nullif(trim(p->>'blank_name'),''), blank_name),
    one_per_player = coalesce((p->>'one_per_player')::boolean, one_per_player),
    is_open = coalesce((p->>'is_open')::boolean, is_open),
    theme = coalesce(p->'theme', theme)
  where id = e.id;
  if p ? 'prizes' then
    for it in select * from jsonb_array_elements(p->'prizes') loop
      i := i + 1;
      ns := greatest(0, coalesce((it->>'stock')::int, 0));
      select * into cur from prizes where id = nullif(it->>'id','')::uuid and event_id = e.id;
      if found then
        update prizes set name = coalesce(nullif(trim(it->>'name'),''), name), color = coalesce(it->>'color', color),
          shape = coalesce(it->>'shape', shape), weight = greatest(0, coalesce((it->>'weight')::int, weight)),
          initial = greatest(initial + (ns - stock), ns), stock = ns, sort = i
        where id = cur.id;
        keep := keep || cur.id;
      else
        insert into prizes(event_id, name, color, shape, stock, initial, weight, sort)
        values (e.id, coalesce(nullif(trim(it->>'name'),''),'경품'), coalesce(it->>'color','#e2493f'),
          coalesce(it->>'shape','sphere'), ns, ns, greatest(0, coalesce((it->>'weight')::int, 1)), i)
        returning * into cur;
        keep := keep || cur.id;
      end if;
    end loop;
    delete from prizes where event_id = e.id and not (id = any(keep));
  end if;
  select * into e from events where id = e.id;
  return _event_json(e);
end $$;

create or replace function public.admin_reset(p_slug text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  e := _auth(p_slug, p_key);
  delete from players where event_id = e.id;
  delete from plays where event_id = e.id;
  update prizes set stock = initial where event_id = e.id;
  update events set seq = 0 where id = e.id;
end $$;

create or replace function public.admin_claim(p_slug text, p_key text, p_play uuid, p_claimed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  e := _auth(p_slug, p_key);
  update plays set claimed = p_claimed where id = p_play and event_id = e.id;
end $$;

-- create a new event (needs master_code from app_settings; read it once via SQL editor)
create or replace function public.create_event(p_master text, p_title text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_slug text; e public.events;
begin
  if p_master is distinct from (select v from app_settings where k = 'master_code') then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  loop
    v_slug := substr(translate(md5(random()::text || clock_timestamp()::text), '0123456789', 'ghjkmnpqrs'), 1, 6);
    exit when not exists (select 1 from events where slug = v_slug);
  end loop;
  insert into events(slug, title, subtitle) values (v_slug, coalesce(nullif(trim(p_title),''),'새 행사'), 'QR을 찍고 행운의 캡슐을 뽑아보세요')
  returning * into e;
  insert into prizes(event_id, name, color, shape, stock, initial, weight, sort) values
    (e.id, '1등 경품', '#e2493f', 'star', 3, 3, 3, 1),
    (e.id, '2등 경품', '#3f8ee2', 'stripe', 10, 10, 10, 2),
    (e.id, '3등 경품', '#55c46a', 'sphere', 30, 30, 30, 3);
  return jsonb_build_object('slug', e.slug, 'admin_key', e.admin_key);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_event(text), public.draw(text,text,text), public.rotate_token(text,text),
  public.kiosk_draw(text,text), public.admin_get(text,text), public.admin_save(text,text,jsonb),
  public.admin_reset(text,text), public.admin_claim(text,text,uuid,boolean), public.create_event(text,text)
  to anon, authenticated;
