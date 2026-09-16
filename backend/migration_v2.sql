CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_handle VARCHAR(24),
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  account_xp INTEGER NOT NULL DEFAULT 0,
  account_level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_handle VARCHAR(24);
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_level INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS player_stats (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  duel_wins INTEGER NOT NULL DEFAULT 0,
  team_wins INTEGER NOT NULL DEFAULT 0,
  bot_wins INTEGER NOT NULL DEFAULT 0,
  challenges_solved INTEGER NOT NULL DEFAULT 0,
  successful_patches INTEGER NOT NULL DEFAULT 0,
  successful_attempts INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO player_stats(user_id)
SELECT user_id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS rooms (
  room_id CHAR(6) PRIMARY KEY,
  room_name VARCHAR(80) NOT NULL,
  instructor_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  creation_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_status BOOLEAN NOT NULL DEFAULT TRUE,
  mode VARCHAR(20) NOT NULL DEFAULT 'classic',
  match_state VARCHAR(20) NOT NULL DEFAULT 'lobby',
  quick_match BOOLEAN NOT NULL DEFAULT FALSE,
  bot_match BOOLEAN NOT NULL DEFAULT FALSE,
  bot_difficulty VARCHAR(20) NOT NULL DEFAULT 'standard',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS quick_match BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS bot_match BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(20) NOT NULL DEFAULT 'standard';

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
  attacker_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  vulnerability_id UUID REFERENCES vulnerability_profiles(vulnerability_id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  achievement_key VARCHAR(60) NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(user_id, achievement_key)
);

CREATE TABLE IF NOT EXISTS match_history (
  match_id UUID PRIMARY KEY,
  room_id CHAR(6),
  mode VARCHAR(20) NOT NULL,
  quick_match BOOLEAN NOT NULL DEFAULT FALSE,
  bot_match BOOLEAN NOT NULL DEFAULT FALSE,
  bot_difficulty VARCHAR(20),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  winner_user_id UUID,
  winner_team VARCHAR(8),
  participant_count INTEGER NOT NULL DEFAULT 0,
  bot_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS match_participants (
  match_id UUID NOT NULL REFERENCES match_history(match_id) ON DELETE CASCADE,
  participant_key TEXT NOT NULL,
  user_id UUID,
  player_handle VARCHAR(32) NOT NULL,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  team VARCHAR(8),
  result VARCHAR(16),
  match_xp INTEGER NOT NULL DEFAULT 0,
  shield_end INTEGER NOT NULL DEFAULT 100,
  account_xp_awarded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(match_id, participant_key)
);

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  response_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_room ON player_sessions(current_room_id);
CREATE INDEX IF NOT EXISTS idx_activity_room_time ON activity_log(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_history_finished ON match_history(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_participants_user ON match_participants(user_id, match_id);
CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id);
