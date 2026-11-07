-- Recherche plein texte sur les items (FTS5, contenu externe = table items)
CREATE VIRTUAL TABLE `items_fts` USING fts5(title, summary, content, content='items', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `items_fts_ai` AFTER INSERT ON `items` BEGIN
  INSERT INTO items_fts(rowid, title, summary, content) VALUES (new.id, new.title, new.summary_html, new.content_html);
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_ad` AFTER DELETE ON `items` BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, summary, content) VALUES ('delete', old.id, old.title, old.summary_html, old.content_html);
END;
--> statement-breakpoint
CREATE TRIGGER `items_fts_au` AFTER UPDATE OF title, summary_html, content_html ON `items` BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, summary, content) VALUES ('delete', old.id, old.title, old.summary_html, old.content_html);
  INSERT INTO items_fts(rowid, title, summary, content) VALUES (new.id, new.title, new.summary_html, new.content_html);
END;
