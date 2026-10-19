-- Read-only PostgreSQL queries. Explicit Asia/Hebron conversion is session-independent.
-- Q01: immutable table counts
SELECT 'clinics' AS source_table, count(*) AS rows FROM public.clinics
UNION ALL SELECT 'doctors', count(*) FROM public.doctors
UNION ALL SELECT 'patients', count(*) FROM public.patients
UNION ALL SELECT 'appointments', count(*) FROM public.appointments
UNION ALL SELECT 'patient_visit_history', count(*) FROM public.patient_visit_history
UNION ALL SELECT 'calendar_app_export', count(*) FROM public.calendar_app_export;

-- Q02: appointments and no-shows by data-derived clinic, plus overall
SELECT c.clinic_id, c.clinic_name, count(a.appointment_id) AS appointments,
 count(*) FILTER (WHERE a.status='no_show') AS no_shows,
 round(100.0 * count(*) FILTER (WHERE a.status='no_show') / nullif(count(a.appointment_id),0),1) AS no_show_percent
FROM public.clinics c LEFT JOIN public.appointments a USING (clinic_id)
GROUP BY GROUPING SETS ((c.clinic_id,c.clinic_name), ()) ORDER BY c.clinic_id NULLS LAST;

-- Q03: distinct unordered doctor/start collision pairs with flag evidence
SELECT a.appointment_id AS appointment_a, b.appointment_id AS appointment_b,
 a.doctor_id, d.doctor_name, c.clinic_id, c.clinic_name,
 to_char(a.scheduled_at AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD HH24:MI') AS local_start,
 a.status AS status_a, b.status AS status_b,
 (a.status='double_booked' AND b.status='double_booked') AS both_flagged,
 (a.status<>'double_booked' AND b.status<>'double_booked') AS neither_flagged
FROM public.appointments a JOIN public.appointments b
 ON a.appointment_id < b.appointment_id AND a.doctor_id=b.doctor_id AND a.scheduled_at=b.scheduled_at
JOIN public.doctors d ON d.doctor_id=a.doctor_id
JOIN public.clinics c ON c.clinic_id=d.clinic_id ORDER BY appointment_a, appointment_b;

-- Q04: same-patient, exact-start, different-clinic unordered pairs
SELECT a.patient_id, a.appointment_id AS appointment_a, b.appointment_id AS appointment_b,
 a.clinic_id AS clinic_a, b.clinic_id AS clinic_b,
 to_char(a.scheduled_at AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD HH24:MI') AS local_start
FROM public.appointments a JOIN public.appointments b
 ON a.appointment_id < b.appointment_id AND a.patient_id=b.patient_id
 AND a.scheduled_at=b.scheduled_at AND a.clinic_id<>b.clinic_id
ORDER BY a.patient_id, a.scheduled_at;

-- Q05: local patient-days at two or more distinct clinics, not collision pairs
SELECT patient_id, to_char(scheduled_at AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD') AS local_day,
 count(DISTINCT clinic_id) AS clinic_count, array_agg(DISTINCT clinic_id ORDER BY clinic_id) AS clinics
FROM public.appointments
GROUP BY patient_id, (scheduled_at AT TIME ZONE 'Asia/Hebron')::date,
 to_char(scheduled_at AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD')
HAVING count(DISTINCT clinic_id)>=2 ORDER BY patient_id, local_day;

-- Q06: actual visit history only (not appointment bookings)
WITH patients_with_visits AS (
 SELECT patient_id, count(DISTINCT clinic_id) AS clinics FROM public.patient_visit_history GROUP BY patient_id
)
SELECT (SELECT count(*) FROM public.patients) AS roster_patients,
 count(*) AS patients_with_visits, count(*) FILTER (WHERE clinics>=2) AS multi_clinic_visit_patients,
 (SELECT count(*) FROM public.patients)-count(*) AS without_visits,
 (SELECT count(*) FROM public.patient_visit_history) AS visits,
 (SELECT min(visit_date)::text FROM public.patient_visit_history) AS first_visit,
 (SELECT max(visit_date)::text FROM public.patient_visit_history) AS last_visit
FROM patients_with_visits;

-- Q07: booking source and appointment span/grid
SELECT booking_method, count(*) AS appointments,
 min((scheduled_at AT TIME ZONE 'Asia/Hebron')::date)::text AS first_day,
 max((scheduled_at AT TIME ZONE 'Asia/Hebron')::date)::text AS last_day,
 bool_and(extract(minute FROM scheduled_at AT TIME ZONE 'Asia/Hebron')::int % 15=0
 AND extract(second FROM scheduled_at)=0) AS on_15_minute_grid
FROM public.appointments GROUP BY booking_method ORDER BY booking_method;

-- Q08: independent email mapping audit; no roster email exists.
-- Analytical assumption: exact email local-part equals the first name after "Dr. "
-- at a clinic whose source booking_method is calendar_app. Ambiguity stays unresolved.
WITH emails AS (SELECT DISTINCT doctor_email FROM public.calendar_app_export)
SELECT e.doctor_email, count(d.doctor_id) AS candidate_count,
 array_agg(d.doctor_id ORDER BY d.doctor_id) FILTER (WHERE d.doctor_id IS NOT NULL) AS doctor_ids,
 array_agg(d.doctor_name ORDER BY d.doctor_id) FILTER (WHERE d.doctor_id IS NOT NULL) AS doctor_names,
 array_agg(c.clinic_id ORDER BY d.doctor_id) FILTER (WHERE c.clinic_id IS NOT NULL) AS clinic_ids
FROM emails e
LEFT JOIN (public.doctors d JOIN public.clinics c ON c.clinic_id=d.clinic_id AND c.booking_method='calendar_app')
 ON lower(split_part(d.doctor_name,' ',2))=split_part(e.doctor_email,'@',1)
GROUP BY e.doctor_email ORDER BY e.doctor_email;

-- Q09: one row per export event; EXISTS prevents duplicate-name/collision multiplication.
WITH candidates AS (
 SELECT e.doctor_email, d.doctor_id, d.clinic_id
 FROM (SELECT DISTINCT doctor_email FROM public.calendar_app_export) e
 JOIN public.doctors d ON lower(split_part(d.doctor_name,' ',2))=split_part(e.doctor_email,'@',1)
 JOIN public.clinics c ON c.clinic_id=d.clinic_id AND c.booking_method='calendar_app'
), mapping AS (
 SELECT doctor_email, min(doctor_id) AS doctor_id, min(clinic_id) AS clinic_id
 FROM candidates GROUP BY doctor_email HAVING count(*)=1
)
SELECT e.event_id, e.doctor_email, m.doctor_id, m.clinic_id, e.patient_name_typed,
 to_char(e.start_time AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD HH24:MI') AS local_start,
 EXISTS(SELECT 1 FROM public.patients p WHERE p.patient_name=e.patient_name_typed) AS exact_name_suggestion,
 ARRAY(SELECT p.patient_id FROM public.patients p WHERE p.patient_name=e.patient_name_typed ORDER BY p.patient_id) AS suggested_patient_ids,
 EXISTS(SELECT 1 FROM public.appointments a WHERE a.doctor_id=m.doctor_id
 AND a.clinic_id=m.clinic_id AND a.scheduled_at=e.start_time) AS doctor_start_match,
 ARRAY(SELECT a.appointment_id FROM public.appointments a WHERE a.doctor_id=m.doctor_id
 AND a.clinic_id=m.clinic_id AND a.scheduled_at=e.start_time ORDER BY a.appointment_id) AS appointment_ids,
 true AS requires_manual_review
FROM public.calendar_app_export e LEFT JOIN mapping m USING(doctor_email) ORDER BY e.event_id;

-- Q10: export duration and its own collisions (not evidence of patient identity)
SELECT count(*) AS events, bool_and(end_time-start_time=interval '30 minutes') AS all_30_minutes,
 (SELECT count(*) FROM public.calendar_app_export a JOIN public.calendar_app_export b
 ON a.event_id<b.event_id AND a.doctor_email=b.doctor_email AND a.start_time=b.start_time) AS collision_pairs
FROM public.calendar_app_export;

-- Q11: vocabulary, approximate age cohort, and doctor-home-clinic consistency
SELECT (SELECT array_agg(DISTINCT status ORDER BY status) FROM public.appointments) AS appointment_statuses,
 (SELECT array_agg(DISTINCT event_status ORDER BY event_status) FROM public.calendar_app_export) AS export_statuses,
 (SELECT count(*) FROM public.patients WHERE dob >= date '2008-01-01') AS born_2008_or_later,
 (SELECT count(*) FROM public.appointments a JOIN public.doctors d USING(doctor_id) WHERE a.clinic_id<>d.clinic_id) AS doctor_clinic_mismatches;

-- Q12: supporting export collision evidence
SELECT a.event_id AS event_a, b.event_id AS event_b, a.doctor_email,
 to_char(a.start_time AT TIME ZONE 'Asia/Hebron','YYYY-MM-DD HH24:MI') AS local_start,
 a.event_status AS status_a, b.event_status AS status_b
FROM public.calendar_app_export a JOIN public.calendar_app_export b
 ON a.event_id<b.event_id AND a.doctor_email=b.doctor_email AND a.start_time=b.start_time;
