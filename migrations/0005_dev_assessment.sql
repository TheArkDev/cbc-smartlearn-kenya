-- DEV SEED ONLY: placeholder quiz so the learner flow can be tested. Not official content.
INSERT INTO assessments (id, title, sub_strand_id, status, approved, version, published_at)
VALUES ('asm-001','Fractions quick check (dev sample)','ss-g5-math-frac','published',1,1,datetime('now'));

INSERT INTO assessment_outcomes (assessment_id, outcome_id) VALUES ('asm-001','lo-frac-1'),('asm-001','lo-frac-2');

INSERT INTO assessment_questions (id, assessment_id, question_type, prompt, points, options_json, sort_order) VALUES
 ('asm1-q1','asm-001','mcq','[placeholder] Which fraction shows one half?',1,
  '[{"id":"q1a","label":"1/2"},{"id":"q1b","label":"1/4"},{"id":"q1c","label":"2/3"}]',1),
 ('asm1-q2','asm-001','true_false','[placeholder] 1/4 is bigger than 1/2.',1,
  '[{"id":"q2t","label":"True"},{"id":"q2f","label":"False"}]',2),
 ('asm1-q3','asm-001','short_answer','[placeholder] How many halves make one whole?',1,NULL,3);

INSERT INTO answer_keys (question_id, correct_option_id, accepted_json, explanation) VALUES
 ('asm1-q1','q1a',NULL,'[placeholder] One half is 1 part out of 2 equal parts.'),
 ('asm1-q2','q2f',NULL,'[placeholder] Quarters are smaller than halves.'),
 ('asm1-q3',NULL,'["2","two"]','[placeholder] Two halves make a whole.');
