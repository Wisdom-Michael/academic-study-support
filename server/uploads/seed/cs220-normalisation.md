# Normalisation from 1NF to BCNF

Normalisation is the process of organising relational tables so that each fact is stored **once**. Redundant data causes three kinds of anomaly:

- **Update anomaly:** a fact stored in many rows gets changed in some but not others.
- **Insertion anomaly:** you can't record one fact without inventing another.
- **Deletion anomaly:** deleting one fact accidentally deletes another.

The normal forms are a ladder of rules. Each one removes a specific kind of redundancy.

## Functional dependencies

A **functional dependency** X → Y means: if two rows agree on X, they must agree on Y. For example, `student_id → student_name`. Normal forms are defined in terms of these dependencies and the table's **candidate keys**.

## First Normal Form (1NF)

A table is in 1NF when every attribute holds a single **atomic** value and there are no repeating groups.

| student_id | modules            |
|------------|--------------------|
| 4          | CS201, CS220       |

This violates 1NF. Split it so each row holds one module:

| student_id | module_code |
|------------|-------------|
| 4          | CS201       |
| 4          | CS220       |

## Second Normal Form (2NF)

A table is in 2NF when it is in 1NF and no non-key attribute depends on **part** of a composite key (a *partial dependency*).

`Enrolment(student_id, module_code, student_name, grade)`, with key (student_id, module_code)

`student_name` depends only on `student_id`, which is part of the key. Move it to a `Student` table. Note that a partial dependency is only possible when the key has more than one attribute. A table with a single-attribute key in 1NF is automatically in 2NF.

## Third Normal Form (3NF)

A table is in 3NF when it is in 2NF and no non-key attribute depends on another non-key attribute (a *transitive dependency*).

`Module(module_code, lecturer_id, lecturer_office)`

Here `module_code → lecturer_id → lecturer_office`. The office is a fact about the lecturer, not the module. Move it to a `Lecturer` table.

A handy summary of 3NF: every non-key attribute must depend on "the key, the whole key, and nothing but the key."

## Boyce–Codd Normal Form (BCNF)

A table is in BCNF when, for **every** non-trivial dependency X → Y, X is a superkey.

3NF allows one exception: a dependency whose right-hand side is part of a candidate key. BCNF removes that exception, so it is strictly stronger. Every BCNF table is in 3NF, but not every 3NF table is in BCNF.

Example: `Tutoring(student, module, tutor)` where each tutor teaches exactly one module (`tutor → module`), and each student has one tutor per module. The candidate keys are (student, module) and (student, tutor). `tutor → module` breaks BCNF because `tutor` alone is not a superkey. Decompose into `TutorModule(tutor, module)` and `StudentTutor(student, tutor)`.

## How far to go

Most practical schemas aim for 3NF or BCNF. Sometimes designers deliberately **denormalise** for read performance, but they should do it knowingly, accepting the anomalies it reintroduces.

## Check your understanding

- Which normal form deals with partial dependencies, and why do they need a composite key?
- What is a transitive dependency?
- Why is BCNF stronger than 3NF?
