/** Static SQL fragments only: placeholders are never taken from request data.
 * Mutable bookings/history are NOT authorization. Legacy grants are populated
 * from immutable seed relationships; future verified linkage needs its own service.
 */
export function patientScopeSql(clinicParameter: "$1" | "$2"): string {
  return `p.merged_into_id IS NULL AND (p.created_clinic_id=${clinicParameter}
    OR EXISTS(SELECT 1 FROM operational.patient_clinic_access access
      WHERE access.patient_id=p.patient_id AND access.clinic_id=${clinicParameter}))`;
}
