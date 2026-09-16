CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id CHAR(6) PRIMARY KEY,
  room_name VARCHAR(80) NOT NULL,
  instructor_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  creation_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_status BOOLEAN NOT NULL DEFAULT TRUE,
  mode VARCHAR(20) NOT NULL DEFAULT 'classic',
  match_state VARCHAR(20) NOT NULL DEFAULT 'lobby',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS player_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  player_handle VARCHAR(32) NOT NULL,
  current_room_id CHAR(6) REFERENCES rooms(room_id) ON DELETE CASCADE,
  active_score_xp INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1,
  defensive_shield_status INTEGER NOT NULL DEFAULT 100 CHECK(defensive_shield_status BETWEEN 0 AND 100),
  connection_status VARCHAR(10) NOT NULL DEFAULT 'offline',
  team VARCHAR(8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(current_room_id, player_handle)
);

CREATE TABLE IF NOT EXISTS vulnerability_profiles (
  vulnerability_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id CHAR(6) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  vulnerability_key VARCHAR(100) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  mock_port INTEGER NOT NULL,
  fictional_service VARCHAR(100) NOT NULL,
  mock_version VARCHAR(60) NOT NULL,
  description TEXT NOT NULL,
  safety_hint TEXT NOT NULL,
  challenge_type VARCHAR(40) NOT NULL,
  challenge_prompt TEXT NOT NULL,
  expected_answer_hash TEXT NOT NULL,
  patched BOOLEAN NOT NULL DEFAULT FALSE,
  ai_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exploit_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id CHAR(6) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  attacker_id UUID NOT NULL,
  target_key TEXT NOT NULL,
  vulnerability_id UUID NOT NULL REFERENCES vulnerability_profiles(vulnerability_id) ON DELETE CASCADE,
  success BOOLEAN NOT NULL,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  log_id BIGSERIAL PRIMARY KEY,
  room_id CHAR(6),
  actor_user_id UUID,
  target_user_id UUID,
  event_type VARCHAR(80) NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  response_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_room ON player_sessions(current_room_id);
CREATE INDEX IF NOT EXISTS idx_activity_room_time ON activity_log(room_id, created_at DESC);
