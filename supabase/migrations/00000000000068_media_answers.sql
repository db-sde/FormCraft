-- Video and audio answers (roadmap #21, 2026-11-20): recordings made in
-- the respondent's browser are stored like any other upload (private
-- bucket, one per question, deleted with the response, read through
-- short-lived signed links). The server sniffs the bytes and caps the
-- size from the question's time limit; the bucket also refuses any
-- other type.
update storage.buckets
set allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
      'audio/webm', 'audio/ogg', 'audio/mp4', 'video/webm', 'video/mp4'
    ]
where id = 'response-uploads';
