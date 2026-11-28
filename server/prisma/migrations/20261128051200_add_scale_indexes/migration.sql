-- Add hot-path indexes for 100-student scale (P5):
-- - exam_attempts(examId, status): deadline settlement & exam results filtering
-- - sessions(expiresAt): periodic stale-session cleanup
-- - submissions(taskId): task regrade lookups
-- - submissions(examId, studentId): submission detail & reset queries

CREATE INDEX IF NOT EXISTS "exam_attempts_examId_status_idx" ON "exam_attempts"("examId", "status");
CREATE INDEX IF NOT EXISTS "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE INDEX IF NOT EXISTS "submissions_taskId_idx" ON "submissions"("taskId");
CREATE INDEX IF NOT EXISTS "submissions_examId_studentId_idx" ON "submissions"("examId", "studentId");
