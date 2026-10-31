import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Create the application data directory, open SQLite, and apply additive schema migrations. */
export function initializeDatabase(dataDirectory) {
  fs.mkdirSync(path.join(dataDirectory, "files"), { recursive: true });
  const db = new DatabaseSync(path.join(dataDirectory, "lecturesync.db"));

db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created INT NOT NULL,workspace_seeded INT NOT NULL DEFAULT 0,is_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INT NOT NULL,created INT NOT NULL);
CREATE TABLE IF NOT EXISTS lectures(id TEXT PRIMARY KEY,title TEXT,subject TEXT,quiz_count INT DEFAULT 5,status TEXT DEFAULT 'created',stage TEXT,stages TEXT DEFAULT '{}',duration REAL,has_video INT DEFAULT 0,media_ext TEXT,slides_ext TEXT,transcript_source TEXT,created INT,owner_id TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS slides(id TEXT PRIMARY KEY,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,n INT,title TEXT,text TEXT,has_image INT DEFAULT 0,status TEXT);
CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,start REAL,end REAL,text TEXT,status TEXT,error TEXT,edited INT DEFAULT 0);
CREATE INDEX IF NOT EXISTS seg_l ON segments(lecture_id,start);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id,expires);
CREATE TABLE IF NOT EXISTS transitions(slide_id TEXT PRIMARY KEY REFERENCES slides(id) ON DELETE CASCADE,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,ts REAL,source TEXT,confidence REAL,evidence TEXT);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,type TEXT,start REAL,slide_id TEXT,source TEXT,segment_ids TEXT,text TEXT);
CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,body TEXT);
CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,score INT,total INT,created INT);
CREATE TABLE IF NOT EXISTS demo_preview_attempts(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS attempt_answers(id TEXT PRIMARY KEY,attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,question_id TEXT,topic TEXT,slide_id TEXT,answer TEXT,correct INT,created INT);
CREATE INDEX IF NOT EXISTS attempt_answers_topic ON attempt_answers(lecture_id,topic,created);
CREATE TABLE IF NOT EXISTS errors(id INTEGER PRIMARY KEY AUTOINCREMENT,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,stage TEXT,message TEXT,created INT);`);
// Safe additive migration for databases created by earlier versions.
try { db.exec("ALTER TABLE lectures ADD COLUMN owner_id TEXT REFERENCES users(id)");
 } catch (e) { if (!String(e.message).includes("duplicate column")) throw e;
 }
try { db.exec("ALTER TABLE users ADD COLUMN workspace_seeded INTEGER NOT NULL DEFAULT 0");
 } catch (e) { if (!String(e.message).includes("duplicate column")) throw e;
 }
try { db.exec("ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0");
 } catch (e) { if (!String(e.message).includes("duplicate column")) throw e;
 }
try { db.exec("ALTER TABLE users ADD COLUMN recovery_hash TEXT");
 } catch (e) { if (!String(e.message).includes("duplicate column")) throw e;
 }
// Existing students with their own uploaded lectures keep their current workspace.
db.exec("UPDATE users SET workspace_seeded=1 WHERE id IN (SELECT DISTINCT owner_id FROM lectures WHERE owner_id IS NOT NULL AND COALESCE(transcript_source,'') NOT LIKE 'SAMPLE DATA%')");
db.exec("CREATE INDEX IF NOT EXISTS lectures_owner_created ON lectures(owner_id,created DESC)");
  return db;
}
