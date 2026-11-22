-- Email-based collaboration access and optional password-protected links.
ALTER TABLE shares ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE peers ADD COLUMN user_id TEXT;

CREATE TABLE collaboration_invites (
  room TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created INTEGER NOT NULL,
  PRIMARY KEY (room, email)
);
CREATE INDEX collaboration_invites_email ON collaboration_invites (email, room);
