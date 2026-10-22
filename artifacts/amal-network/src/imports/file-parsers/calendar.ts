import ICAL from 'ical.js';
import { bounded, canonicalize, fail, MAX_ROWS, type Row, timestamp, zonedTime } from './common';

export function parseCalendar(text: string): Row[] {
  const calendar = new ICAL.Component(ICAL.parse(text));
  if (calendar.name !== 'vcalendar') fail('errCalendar');
  const events = calendar.getAllSubcomponents('vevent');
  if (events.length > MAX_ROWS) fail('errRowLimit');
  return bounded(events.map((event, index) => {
    const row = index + 1;
    for (const key of ['rrule', 'rdate', 'exdate', 'recurrence-id']) {
      if (event.hasProperty(key)) fail('errRecurrence', row, key);
    }
    const single = (key: string): unknown => {
      const values = event.getAllProperties(key);
      if (values.length > 1) fail('errCalendar', row, key);
      return values[0]?.getFirstValue();
    };
    const time = (key: string): string => {
      const properties = event.getAllProperties(key);
      if (properties.length !== 1) return fail(key === 'dtend' && event.hasProperty('duration') ? 'errDuration' : 'errCalendarTime', row, key);
      const property = properties[0]!;
      // Validate original parsed calendar components before ICAL.Time can
      // normalize an invalid day/hour into a different (apparently valid) date.
      const raw = property.toJSON()[3];
      if (property.type !== 'date-time' || typeof raw !== 'string') return fail('errAllDay', row, key);
      timestamp(raw, row, key);
      const value = property.getFirstValue();
      if (!(value instanceof ICAL.Time) || value.isDate) return fail('errAllDay', row, key);
      const local = timestamp(value.toString().replace(/Z$/, ''), row, key);
      const tzid = property.getParameter('tzid');
      if (Array.isArray(tzid)) return fail('errTimezone', row, key);
      const zone = tzid ?? (value.zone.tzid === 'UTC' ? 'UTC' : 'floating');
      return zonedTime(local, zone, row, key);
    };
    const uid = single('uid');
    if (typeof uid !== 'string' || !uid.trim() || uid.length > 1024) fail('errId', row, 'event_uid');
    const organizer = single('organizer');
    const doctorOverride = single('x-doctor-email');
    const doctor = doctorOverride ?? (typeof organizer === 'string' && /^mailto:/i.test(organizer) ? organizer.slice(7) : undefined);
    const patient = single('x-patient-name') ?? single('summary');
    const status = single('status');
    if (typeof status !== 'string' || !['confirmed', 'completed', 'cancelled'].includes(status.toLowerCase())) fail('errStatus', row, 'event_status');
    return canonicalize({
      event_id: 1, event_uid: uid, doctor_email: doctor, patient_name_typed: patient,
      start_time: time('dtstart'), end_time: time('dtend'), event_status: status,
    }, row);
  }));
}
