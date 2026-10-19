# Source-compatible column inventory

Every listed column is NOT NULL; the first column is the source primary key.
Excel IDs are integer cells, text columns are strings, and date/time columns
are Excel datetime cells. No additional operational columns or inferred foreign
keys were imposed. Source table/column order and all values are preserved.

| Sheet | Columns in original order (PostgreSQL storage type) |
|---|---|
| clinics | clinic_id integer; clinic_name text; city text; booking_method text |
| doctors | doctor_id integer; doctor_name text; clinic_id integer; specialty text |
| patients | patient_id integer; patient_name text; phone text; dob date |
| appointments | appointment_id integer; clinic_id integer; doctor_id integer; patient_id integer; scheduled_at timestamptz; booking_method text; status text |
| patient_visit_history | visit_id integer; patient_id integer; clinic_id integer; doctor_id integer; visit_date date; diagnosis_notes text |
| calendar_app_export | event_id integer; doctor_email text; patient_name_typed text; start_time timestamptz; end_time timestamptz; event_status text |

All 25 phone cells are strings; leading zeros survive. Birth/visit dates have
no time-of-day meaning. Timestamp interpretation and provenance hash are in
`baseline-summary.md`. The strict workbook reader rejects unknown cell types,
nulls, changed headers, non-midnight date-only fields, and duplicate IDs.
