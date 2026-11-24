-- DEV SEED ONLY. Structure is real; strand/outcome/lesson TEXT IS PLACEHOLDER (verified = 0).
-- Replace with data imported from the official KICD curriculum designs before any pilot.

INSERT INTO education_levels (id, name, sort_order) VALUES
 ('pre-primary','Pre-Primary',1),('lower-primary','Lower Primary',2),
 ('upper-primary','Upper Primary',3),('junior','Junior School',4),('senior','Senior School',5);

INSERT INTO grades (id, level_id, name, sort_order) VALUES
 ('pp1','pre-primary','PP1',1),('pp2','pre-primary','PP2',2),
 ('grade-1','lower-primary','Grade 1',3),('grade-2','lower-primary','Grade 2',4),('grade-3','lower-primary','Grade 3',5),
 ('grade-4','upper-primary','Grade 4',6),('grade-5','upper-primary','Grade 5',7),('grade-6','upper-primary','Grade 6',8),
 ('grade-7','junior','Grade 7',9),('grade-8','junior','Grade 8',10),('grade-9','junior','Grade 9',11),
 ('grade-10','senior','Grade 10',12),('grade-11','senior','Grade 11',13),('grade-12','senior','Grade 12',14);

INSERT INTO pathways (id, name) VALUES
 ('stem','STEM'),('social-sciences','Social Sciences'),('arts-sports','Arts & Sports Science');

INSERT INTO curriculum_sources (id, title, source_url, origin, license, attribution) VALUES
 ('src-dev','DEV placeholder content','https://kicd.ac.ke/cbc-materials/','smartlearn_original','internal-dev-only','Replace with KICD design reference');

INSERT INTO curriculum_versions (id, name, status) VALUES ('cv-dev','Dev curriculum v0','active');

INSERT INTO subjects (id, name) VALUES ('mathematics','Mathematics'),('english','English'),('science-tech','Science and Technology');

INSERT INTO grade_subjects (id, curriculum_version_id, grade_id, subject_id, source_id) VALUES
 ('gs-g5-math','cv-dev','grade-5','mathematics','src-dev'),
 ('gs-g5-eng','cv-dev','grade-5','english','src-dev'),
 ('gs-g5-sci','cv-dev','grade-5','science-tech','src-dev');

INSERT INTO strands (id, grade_subject_id, title, sort_order) VALUES
 ('st-g5-math-num','gs-g5-math','Numbers',1),
 ('st-g5-math-meas','gs-g5-math','Measurement',2);

INSERT INTO sub_strands (id, strand_id, title, sort_order) VALUES
 ('ss-g5-math-frac','st-g5-math-num','Fractions',1),
 ('ss-g5-math-len','st-g5-math-meas','Length',1);

INSERT INTO learning_outcomes (id, sub_strand_id, description, sort_order) VALUES
 ('lo-frac-1','ss-g5-math-frac','[placeholder] Identify fractions in everyday situations',1),
 ('lo-frac-2','ss-g5-math-frac','[placeholder] Compare fractions',2);

INSERT INTO lessons (id, sub_strand_id, title, estimated_minutes, status, published_at, source_id) VALUES
 ('lesson-001','ss-g5-math-frac','Introduction to Fractions',25,'published',datetime('now'),'src-dev');

INSERT INTO lesson_outcomes (lesson_id, outcome_id) VALUES ('lesson-001','lo-frac-1'),('lesson-001','lo-frac-2');

INSERT INTO lesson_sections (id, lesson_id, section_type, title, content_json, sort_order) VALUES
 ('ls-1','lesson-001','introduction','Getting started','{"text":"[placeholder] Think of sharing a chapati equally between friends."}',1),
 ('ls-2','lesson-001','explanation','What is a fraction?','{"text":"[placeholder] A fraction is a part of a whole."}',2),
 ('ls-3','lesson-001','practice','Try it','{"text":"[placeholder] Shade 1/2 of the shape."}',3);
