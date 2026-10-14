import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const dbPath = process.env.DATABASE_PATH || './data/dailyservice.db';

const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    auth_user_id TEXT NOT NULL UNIQUE,
    telegram_id TEXT,
    telegram_chat_id TEXT,
    google_id TEXT,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    photo_url TEXT,
    active_group_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT NOT NULL UNIQUE,
    chat_id TEXT UNIQUE,
    thread_id TEXT,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Bishkek',
    private_remind_time TEXT NOT NULL DEFAULT '16:30',
    is_private_remind_enabled INTEGER NOT NULL DEFAULT 1,
    public_remind_time TEXT NOT NULL DEFAULT '09:10',
    is_public_remind_enabled INTEGER NOT NULL DEFAULT 1,
    group_report_time TEXT NOT NULL DEFAULT '09:15',
    is_group_report_enabled INTEGER NOT NULL DEFAULT 1,
    next_day_rollover_hour INTEGER NOT NULL DEFAULT 16,
    work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
    is_active INTEGER NOT NULL DEFAULT 1,
    init_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (admin_user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_profile_id TEXT,
    telegram_username TEXT NOT NULL,
    telegram_id TEXT,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    include_in_dailies INTEGER NOT NULL DEFAULT 1,
    can_export_xlsx INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS daily_tasks (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    user_profile_id TEXT,
    telegram_username TEXT NOT NULL,
    yesterday TEXT NOT NULL,
    today TEXT,
    report_date TEXT NOT NULL,
    iso_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES group_members(id) ON DELETE CASCADE,
    FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_chats (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL UNIQUE,
    thread_id TEXT,
    title TEXT,
    type TEXT NOT NULL,
    registered_by_telegram_id TEXT,
    registered_by_username TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_group_username
    ON group_members(group_id, lower(telegram_username));

  CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_tasks_group_member_date
    ON daily_tasks(group_id, member_id, report_date);

  CREATE INDEX IF NOT EXISTS idx_daily_tasks_group_iso
    ON daily_tasks(group_id, iso_date DESC);

  CREATE INDEX IF NOT EXISTS idx_daily_tasks_user
    ON daily_tasks(user_profile_id, iso_date DESC);
`);

export const db = drizzle(sqlite, { schema });
