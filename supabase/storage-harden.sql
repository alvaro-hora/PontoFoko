-- Storage: leitura pública (exibir fotos) + insert; sem delete/update aberto
drop policy if exists "session_photos_public_delete" on storage.objects;
drop policy if exists "session_photos_public_update" on storage.objects;
-- insert/read já existem em migration.sql
