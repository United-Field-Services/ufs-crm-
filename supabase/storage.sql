-- A private bucket for uploaded files (documents, leave attachments, profile photos). Run once after schema.sql.
-- "public = false" means no file has a public link; the app downloads files with the server key after checking permissions.
-- No storage policies are added on purpose: the public roles get no access to the bucket at all.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ufs-files', 'ufs-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;
