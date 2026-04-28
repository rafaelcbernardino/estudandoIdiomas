// Uses Node.js built-in SQLite (stable in Node.js 24+, no native compilation)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'learning.db');

let db;

function initDB() {
  if (!fs.existsSync(__dirname)) {
    fs.mkdirSync(__dirname, { recursive: true });
  }

  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      course     TEXT NOT NULL,
      aula       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (course, aula)
    );

    CREATE TABLE IF NOT EXISTS homework_answers (
      course      TEXT NOT NULL,
      aula        TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      answer      TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (course, aula, exercise_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      audio_path TEXT NOT NULL PRIMARY KEY,
      segments   TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function getDB() {
  if (!db) initDB();
  return db;
}

module.exports = { initDB, getDB };
