-- =====================================================================
-- Integrated Academic Study Support System: Data Tier
-- MySQL 8.0+ setup script: creates academic_support_db, all tables,
-- and sample seed data for demonstrating every module.
--
-- WARNING: this script DROPS and recreates the database. Re-running it
-- resets all data back to the seed state.
--
-- Run with either:
--   mysql -u root -p < schema.sql
--   npm run db:init --prefix server     (uses the credentials in .env)
-- =====================================================================

DROP DATABASE IF EXISTS academic_support_db;
CREATE DATABASE academic_support_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE academic_support_db;

-- ---------------------------------------------------------------------
-- Core tables (as specified in the project data dictionary)
-- ---------------------------------------------------------------------

CREATE TABLE users (
  user_id             INT AUTO_INCREMENT PRIMARY KEY,
  full_name           VARCHAR(120) NOT NULL,
  institutional_email VARCHAR(190) NOT NULL UNIQUE,
  password_hash       VARCHAR(255) NOT NULL,
  role                ENUM('student', 'mentor', 'faculty_admin') NOT NULL DEFAULT 'student'
);

CREATE TABLE course_materials (
  material_id    INT AUTO_INCREMENT PRIMARY KEY,
  title          VARCHAR(200) NOT NULL,
  module_code    VARCHAR(20)  NOT NULL,
  file_path      VARCHAR(255) NOT NULL,   -- relative to server/uploads
  uploaded_by_id INT NOT NULL,
  CONSTRAINT fk_materials_uploader
    FOREIGN KEY (uploaded_by_id) REFERENCES users (user_id),
  INDEX idx_materials_module (module_code)
);

CREATE TABLE milestone_progress (
  progress_id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id            INT NOT NULL,
  material_id           INT NOT NULL,
  completion_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  score_achieved        INT NULL,          -- latest concept-check score (0-100); NULL = not attempted
  last_updated          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_progress_student
    FOREIGN KEY (student_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_progress_material
    FOREIGN KEY (material_id) REFERENCES course_materials (material_id) ON DELETE CASCADE,
  -- One progress row per student per material, so progress can be upserted
  CONSTRAINT uq_progress_student_material UNIQUE (student_id, material_id)
);

CREATE TABLE peer_matches (
  match_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id   INT NOT NULL,               -- struggling student
  mentor_id    INT NOT NULL,               -- peer mentor
  module_code  VARCHAR(20) NOT NULL,
  match_status ENUM('pending', 'active', 'completed') NOT NULL DEFAULT 'pending',
  CONSTRAINT fk_matches_student
    FOREIGN KEY (student_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_matches_mentor
    FOREIGN KEY (mentor_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE risk_alerts (
  alert_id          INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT NOT NULL,
  risk_level        ENUM('low', 'medium', 'high') NOT NULL,
  trigger_reason    TEXT NOT NULL,
  resolution_status ENUM('unresolved', 'in_review', 'resolved') NOT NULL DEFAULT 'unresolved',
  CONSTRAINT fk_alerts_student
    FOREIGN KEY (student_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- Supporting tables (added to make the modules work end to end)
-- ---------------------------------------------------------------------

-- Which modules each peer mentor can support, and how many students
-- they can take on at once. Used by the peer-matching algorithm.
CREATE TABLE mentor_modules (
  mentor_id          INT NOT NULL,
  module_code        VARCHAR(20) NOT NULL,
  max_active_matches INT NOT NULL DEFAULT 3,
  PRIMARY KEY (mentor_id, module_code),
  CONSTRAINT fk_mentor_modules_mentor
    FOREIGN KEY (mentor_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- One formative concept check at the end of each study chapter (material).
CREATE TABLE concept_checks (
  check_id    INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL UNIQUE,
  title       VARCHAR(200) NOT NULL,
  CONSTRAINT fk_checks_material
    FOREIGN KEY (material_id) REFERENCES course_materials (material_id) ON DELETE CASCADE
);

-- Multiple-choice and true/false questions. `options` is a JSON array of
-- answer strings; `correct_index` points into it. Answers never leave the
-- server until the student submits.
CREATE TABLE quiz_questions (
  question_id   INT AUTO_INCREMENT PRIMARY KEY,
  check_id      INT NOT NULL,
  question_type ENUM('multiple_choice', 'true_false') NOT NULL,
  prompt        TEXT NOT NULL,
  options       JSON NOT NULL,
  correct_index TINYINT NOT NULL,
  explanation   TEXT NULL,
  position      INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_questions_check
    FOREIGN KEY (check_id) REFERENCES concept_checks (check_id) ON DELETE CASCADE
);

-- Uploaded files are stored in the database rather than on disk, so they survive
-- hosts that wipe local storage on restart. (The seed chapters ship as files in
-- server/uploads/seed instead.)
CREATE TABLE material_files (
  material_id   INT PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT NOT NULL,
  content       LONGBLOB NOT NULL,
  CONSTRAINT fk_files_material
    FOREIGN KEY (material_id) REFERENCES course_materials (material_id) ON DELETE CASCADE
);

-- Contact details shared with a peer once both sides accept a match, and whether
-- a student who is doing well may be asked to help others.
CREATE TABLE user_profiles (
  user_id           INT PRIMARY KEY,
  phone_number      VARCHAR(30) NULL,
  available_to_help TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- Each peer match's context and each side's answer. peer_matches.match_status stays
-- 'pending' until both have accepted, then becomes 'active'.
CREATE TABLE match_details (
  match_id            INT PRIMARY KEY,
  reason              VARCHAR(255) NULL,   -- why the student needs help (shown to the helper)
  helper_summary      VARCHAR(255) NULL,   -- why this helper (shown to the student)
  student_accepted_at TIMESTAMP NULL,
  helper_accepted_at  TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paired_by_id        INT NULL,            -- the lecturer who made the pairing (NULL = suggested automatically)
  lecturer_note       VARCHAR(500) NULL,   -- optional note from that lecturer, shown to both students
  CONSTRAINT fk_details_match FOREIGN KEY (match_id) REFERENCES peer_matches (match_id) ON DELETE CASCADE
);

-- Pairings someone declined, so the same two people aren't suggested again.
CREATE TABLE declined_matches (
  decline_id  INT AUTO_INCREMENT PRIMARY KEY,
  student_id  INT NOT NULL,
  helper_id   INT NOT NULL,
  module_code VARCHAR(20) NOT NULL,
  declined_by ENUM('student', 'helper') NOT NULL,
  declined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_declined_pair (student_id, module_code),
  CONSTRAINT fk_declined_student FOREIGN KEY (student_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_declined_helper FOREIGN KEY (helper_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- In-app notifications shown under the bell in the top bar.
CREATE TABLE notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  body            TEXT NOT NULL,
  link            VARCHAR(255) NULL,
  is_read         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user (user_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- Every successful login, used for the login-frequency risk factor.
CREATE TABLE login_events (
  event_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  logged_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_logins_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  INDEX idx_logins_user_time (user_id, logged_in_at)
);

-- =====================================================================
-- Seed data
-- Every demo account uses the password:  Study@2026
-- =====================================================================

INSERT INTO users (user_id, full_name, institutional_email, password_hash, role) VALUES
  (1, 'Dr. Helen Okafor', 'h.okafor@university.edu',  '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'faculty_admin'),
  (2, 'Priya Raman',      'p.raman@university.edu',   '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'mentor'),
  (3, 'Daniel Mensah',    'd.mensah@university.edu',  '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'mentor'),
  (4, 'Chidi Eze',        'c.eze@university.edu',     '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'student'),
  (5, 'Fatima Bello',     'f.bello@university.edu',   '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'student'),
  (6, 'Tom Hughes',       't.hughes@university.edu',  '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'student'),
  (7, 'Grace Nwosu',      'g.nwosu@university.edu',   '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'student'),
  (8, 'Lukas Weber',      'l.weber@university.edu',   '$2b$10$sAmljEMwOw0bGhMZvlZgqu4gp0.9PzOLaYkXjkg1SHR5td0hOg9Da', 'student');

INSERT INTO course_materials (material_id, title, module_code, file_path, uploaded_by_id) VALUES
  (1, 'Asymptotic analysis and Big-O notation', 'CS201', 'seed/cs201-asymptotic-analysis.md', 1),
  (2, 'Recursion and the call stack',           'CS201', 'seed/cs201-recursion.md',           1),
  (3, 'Normalisation from 1NF to BCNF',         'CS220', 'seed/cs220-normalisation.md',       1),
  (4, 'The TCP connection lifecycle',           'CS240', 'seed/cs240-tcp-lifecycle.md',       1);

INSERT INTO mentor_modules (mentor_id, module_code, max_active_matches) VALUES
  (2, 'CS201', 3),
  (2, 'CS220', 3),
  (3, 'CS240', 3),
  (3, 'CS201', 2);

INSERT INTO concept_checks (check_id, material_id, title) VALUES
  (1, 1, 'Concept check: Big-O notation'),
  (2, 2, 'Concept check: Recursion'),
  (3, 3, 'Concept check: Normalisation'),
  (4, 4, 'Concept check: TCP lifecycle');

INSERT INTO quiz_questions (check_id, question_type, prompt, options, correct_index, explanation, position) VALUES
  -- CS201: Big-O
  (1, 'multiple_choice',
   'An algorithm does a constant amount of work for every pair of elements in an input of size n. What is its time complexity?',
   '["O(n)", "O(n log n)", "O(n²)", "O(2ⁿ)"]', 2,
   'There are n(n−1)/2 pairs, which grows in proportion to n².', 1),
  (1, 'true_false',
   'Because Big-O is an upper bound, an algorithm that is O(n) is also O(n²).',
   '["True", "False"]', 0,
   'Any function bounded above by n is also bounded above by n². It is a true but looser statement.', 2),
  (1, 'multiple_choice',
   'Binary search on a sorted array of n items runs in:',
   '["O(1)", "O(log n)", "O(n)", "O(n log n)"]', 1,
   'Each comparison halves the remaining search range, so at most about log₂ n comparisons are needed.', 3),
  (1, 'true_false',
   'After dropping constants and lower-order terms, O(3n + 100) is written as O(n).',
   '["True", "False"]', 0,
   'Constant factors and additive constants do not change the growth rate, so 3n + 100 is O(n).', 4),

  -- CS201: Recursion
  (2, 'multiple_choice',
   'What stops a recursive function from calling itself forever?',
   '["A base case", "A global counter", "Tail-call optimisation", "The return type"]', 0,
   'The base case returns without recursing. Every recursive call must move closer to it.', 1),
  (2, 'true_false',
   'Each recursive call gets its own stack frame with its own copies of local variables.',
   '["True", "False"]', 0,
   'A new frame is pushed for every call, which is why deep recursion can overflow the stack.', 2),
  (2, 'multiple_choice',
   'The naive recursive fibonacci(n) makes roughly how many calls?',
   '["O(n)", "O(n²)", "O(2ⁿ)", "O(log n)"]', 2,
   'Each call branches into two more, and the same sub-problems are recomputed many times. Memoisation reduces this to O(n).', 3),
  (2, 'true_false',
   'A recursive solution always uses less memory than the equivalent loop.',
   '["True", "False"]', 1,
   'Recursion usually uses more memory, because every pending call keeps a stack frame alive.', 4),

  -- CS220: Normalisation
  (3, 'multiple_choice',
   'A table is in First Normal Form (1NF) when:',
   '["Every attribute holds a single atomic value", "There are no transitive dependencies", "Every determinant is a candidate key", "It has a surrogate primary key"]', 0,
   '1NF only requires atomic values and no repeating groups. The other options describe 3NF and BCNF.', 1),
  (3, 'multiple_choice',
   'A non-key attribute depends on another non-key attribute. Which normal form does this violate?',
   '["1NF", "2NF", "3NF", "None of them"]', 2,
   'That is a transitive dependency (key → A → B), which 3NF removes.', 2),
  (3, 'true_false',
   'Every table in Boyce–Codd Normal Form is also in Third Normal Form.',
   '["True", "False"]', 0,
   'BCNF is a strictly stronger condition than 3NF.', 3),
  (3, 'true_false',
   'A partial dependency (a 2NF violation) can only occur when the primary key is composite.',
   '["True", "False"]', 0,
   'A partial dependency means depending on part of the key, which requires the key to have more than one attribute.', 4),

  -- CS240: TCP
  (4, 'multiple_choice',
   'What is the order of the TCP three-way handshake?',
   '["SYN, SYN-ACK, ACK", "SYN, ACK, FIN", "ACK, SYN, SYN-ACK", "SYN, ACK, SYN-ACK"]', 0,
   'The client sends SYN, the server replies SYN-ACK, and the client confirms with ACK.', 1),
  (4, 'true_false',
   'TCP delivers bytes to the receiving application in the order they were sent.',
   '["True", "False"]', 0,
   'Sequence numbers let the receiver reorder segments before handing data to the application.', 2),
  (4, 'multiple_choice',
   'Which side of a connection enters the TIME_WAIT state?',
   '["The side that sends the first FIN", "The side that receives the first FIN", "Both sides, always", "Neither; TIME_WAIT belongs to UDP"]', 0,
   'The active closer waits in TIME_WAIT so delayed segments from the old connection cannot corrupt a new one.', 3),
  (4, 'true_false',
   'A TCP connection can be closed in one direction while data still flows in the other.',
   '["True", "False"]', 0,
   'This is a half-close: each direction is shut down by its own FIN.', 4);

-- Reading progress and concept-check scores, chosen so each demo student
-- tells a different story on the faculty risk dashboard.
INSERT INTO milestone_progress (student_id, material_id, completion_percentage, score_achieved, last_updated) VALUES
  -- Chidi: steady and doing well
  (4, 1, 100.00, 100, NOW() - INTERVAL 1 DAY),
  (4, 2,  80.00,  75, NOW() - INTERVAL 2 DAY),
  (4, 3,  60.00, NULL, NOW() - INTERVAL 3 DAY),
  -- Fatima: engaged but failed the Big-O check, so she has a pending mentor match
  (5, 1, 100.00,  25, NOW() - INTERVAL 1 DAY),
  (5, 2,  40.00, NULL, NOW() - INTERVAL 2 DAY),
  -- Tom: started, then went quiet for over two weeks
  (6, 1,  20.00, NULL, NOW() - INTERVAL 16 DAY),
  (6, 3,  10.00, NULL, NOW() - INTERVAL 18 DAY),
  -- Grace: middling progress, struggled with normalisation and is now being mentored
  (7, 1,  70.00,  50, NOW() - INTERVAL 5 DAY),
  (7, 3,  50.00,  25, NOW() - INTERVAL 6 DAY),
  -- Lukas: strong in databases and networks
  (8, 3, 100.00, 100, NOW() - INTERVAL 1 DAY),
  (8, 4,  90.00,  75, NOW() - INTERVAL 1 DAY);

INSERT INTO peer_matches (match_id, student_id, mentor_id, module_code, match_status) VALUES
  (1, 5, 2, 'CS201', 'pending'),   -- Fatima has accepted Priya's help; Priya hasn't answered yet
  (2, 7, 2, 'CS220', 'active');    -- Grace and Priya both accepted, so they can see each other's details

INSERT INTO match_details (match_id, reason, helper_summary, student_accepted_at, helper_accepted_at, created_at) VALUES
  (1, 'Scored 25% on “Asymptotic analysis and Big-O notation”', 'Is a volunteer peer mentor for CS201',
      NOW() - INTERVAL 1 DAY, NULL, NOW() - INTERVAL 1 DAY),
  (2, 'Scored 25% on “Normalisation from 1NF to BCNF”', 'Is a volunteer peer mentor for CS220',
      NOW() - INTERVAL 6 DAY, NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 6 DAY);

-- Phone numbers use the UK's reserved fictional range (07700 900xxx)
INSERT INTO user_profiles (user_id, phone_number, available_to_help) VALUES
  (2, '+44 7700 900102', 1),
  (3, '+44 7700 900103', 1),
  (4, '+44 7700 900104', 1),
  (5, '+44 7700 900105', 1),
  (7, '+44 7700 900107', 1),
  (8, '+44 7700 900108', 1);

INSERT INTO notifications (user_id, title, body, link, is_read, created_at) VALUES
  (5, 'Priya Raman could be your CS201 peer tutor',
      'Priya Raman is a volunteer peer mentor for CS201 and could tutor you. Accept to swap phone numbers and emails; they are only shared once you both agree.',
      '/student#peer-help', 1, NOW() - INTERVAL 1 DAY),
  (2, 'Fatima Bello accepted your help',
      'Fatima Bello would like you as their CS201 peer tutor. Accept too to swap phone numbers and emails.',
      '/mentor#peer-help', 0, NOW() - INTERVAL 1 DAY),
  (7, 'Priya Raman is your peer tutor for CS220',
      'You both accepted. Priya Raman''s phone number and email are on your dashboard.',
      '/student#peer-help', 1, NOW() - INTERVAL 5 DAY);

INSERT INTO login_events (user_id, logged_in_at) VALUES
  (4, NOW() - INTERVAL 1 DAY), (4, NOW() - INTERVAL 2 DAY), (4, NOW() - INTERVAL 3 DAY),
  (4, NOW() - INTERVAL 5 DAY), (4, NOW() - INTERVAL 7 DAY), (4, NOW() - INTERVAL 9 DAY),
  (4, NOW() - INTERVAL 11 DAY),
  (5, NOW() - INTERVAL 1 DAY), (5, NOW() - INTERVAL 2 DAY), (5, NOW() - INTERVAL 6 DAY),
  (5, NOW() - INTERVAL 10 DAY),
  (6, NOW() - INTERVAL 16 DAY), (6, NOW() - INTERVAL 18 DAY), (6, NOW() - INTERVAL 25 DAY),
  (7, NOW() - INTERVAL 5 DAY), (7, NOW() - INTERVAL 6 DAY), (7, NOW() - INTERVAL 12 DAY),
  (8, NOW() - INTERVAL 1 DAY), (8, NOW() - INTERVAL 3 DAY), (8, NOW() - INTERVAL 4 DAY),
  (8, NOW() - INTERVAL 8 DAY), (8, NOW() - INTERVAL 10 DAY);

INSERT INTO risk_alerts (student_id, risk_level, trigger_reason, resolution_status) VALUES
  (6, 'high',   'No study activity for 16 days; no logins in the last 14 days', 'unresolved'),
  (5, 'medium', 'Average concept-check score 25%', 'in_review');
